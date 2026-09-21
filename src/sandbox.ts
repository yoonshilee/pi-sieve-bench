import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createCodingTools, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export async function inside(root: string, path: string): Promise<string> {
    const absolute = resolve(root, path);
    let ancestor = absolute;
    while (true) {
        try {
            ancestor = await realpath(ancestor);
            break;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor)
                throw error;
            ancestor = parent;
        }
    }
    for (const candidate of [absolute, ancestor]) {
        const rel = relative(root, candidate);
        if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
            throw new Error("Path is outside the task workspace.");
    }
    return absolute;
}
export function cleanEnv(root: string): NodeJS.ProcessEnv {
    return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: root, TMPDIR: root, LANG: "en_US.UTF-8", TZ: "UTC", NODE_NO_WARNINGS: "1" };
}
export function profile(root: string): string {
    const sub = (p: string) => `(subpath ${JSON.stringify(p)})`;
    const literal = (p: string) => `(literal ${JSON.stringify(p)})`;
    return `(version 1)(deny default)
(allow process*)(allow sysctl-read)(allow mach-lookup)(allow file-read-metadata)
(allow file-read* (require-all (require-not (subpath "/Users")) (require-not (subpath "/home"))) ${[root, "/usr", "/bin", "/sbin", "/System", "/Library", "/private/var/db/dyld", dirname(dirname(process.execPath))].map(sub).join(" ")} ${["/dev/null", "/dev/urandom", "/dev/random", "/dev/tty", "/private/etc/localtime", "/private/etc/zoneinfo"].map(literal).join(" ")})
(allow file-write* ${sub(root)} ${literal("/dev/null")})
(deny file-write* ${[join(root, ".pi"), join(root, "data")].map(sub).join(" ")} ${[join(root, "AGENTS.md"), join(root, "REFERENCES.md")].map(literal).join(" ")})`;
}
export async function execute(root: string, argv: string[], options: {
    input?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    onData?: (data: Buffer) => void;
    offlineTest?: boolean;
} = {}): Promise<{
    code: number;
    output: string;
}> {
    if (process.platform !== "darwin" && !options.offlineTest)
        throw new Error("Live execution requires the macOS task sandbox.");
    const args = process.platform === "darwin" ? ["-p", profile(root), ...argv] : argv.slice(1);
    const executable = process.platform === "darwin" ? "/usr/bin/sandbox-exec" : argv[0];
    return await new Promise((resolveResult, reject) => {
        const child = spawn(executable, args, { cwd: root, env: cleanEnv(root), stdio: ["pipe", "pipe", "pipe"], detached: true });
        let output = "", ended = false;
        const stop = () => { if (!ended)
            try {
                process.kill(-child.pid!, "SIGKILL");
            }
            catch { /* The process may have already exited. */ } };
        const timer = setTimeout(stop, options.timeoutMs ?? 30000);
        options.signal?.addEventListener("abort", stop, { once: true });
        if (options.signal?.aborted)
            stop();
        const collect = (chunk: Buffer) => { options.onData?.(chunk); if (output.length < 1000000)
            output += chunk.toString(); };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", reject);
        child.on("close", code => { ended = true; clearTimeout(timer); options.signal?.removeEventListener("abort", stop); resolveResult({ code: code ?? 137, output }); });
        child.stdin.on("error", () => { });
        child.stdin.end(options.input);
    });
}
export function sandboxTools(root: string): (pi: ExtensionAPI) => void {
    const checkedRead = async (p: string) => readFile(await inside(root, p));
    const checkedWrite = async (p: string, text: string) => { const path = await inside(root, p); const rel = relative(root, path); if (rel.startsWith(".pi/") || rel.startsWith("data/") || ["AGENTS.md", "REFERENCES.md"].includes(rel))
        throw new Error("Reference files are read-only."); await writeFile(path, text); };
    const checkedAccess = async (p: string) => access(await inside(root, p));
    const tools = createCodingTools(root, {
        read: { operations: { readFile: checkedRead, access: checkedAccess, detectImageMimeType: async () => null } },
        edit: { operations: { readFile: checkedRead, writeFile: checkedWrite, access: checkedAccess } },
        write: { operations: { writeFile: checkedWrite, mkdir: async (p) => { await mkdir(await inside(root, p), { recursive: true }); } } },
        bash: { exposeSessionEnvironment: false, operations: { exec: async (command, _cwd, options) => {
                    const result = await execute(root, ["/bin/bash", "--noprofile", "--norc", "-c", command], { signal: options.signal, timeoutMs: Math.min((options.timeout ?? 30) * 1000, 30000), onData: options.onData });
                    return { exitCode: result.code };
                } } },
    });
    return pi => { for (const tool of tools)
        pi.registerTool({ ...tool, label: tool.name }); };
}
