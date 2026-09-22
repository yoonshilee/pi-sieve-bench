export const SEMANTIC_MODES = ["outcome", "evidence"] as const;
export type SemanticMode = typeof SEMANTIC_MODES[number];
export const SEMANTIC_CRITERIA = {
    outcome: {
        completed: "The observation establishes that the entire requested objective was achieved. Failure of a separate, nonessential notification does not undo an established result.",
        not_applied: "The observation establishes that none of the requested effect occurred, including a confirmed rollback of all effects.",
        partial: "The observation establishes that some, but not all, of the requested objective was achieved.",
        unknown: "The outcome cannot be established from this observation. A timeout, an attempt, or an acknowledgement alone does not prove application or non-application.",
    },
    evidence: {
        supports: "The observation directly establishes or entails the stated hypothesis for the stated subject and scope.",
        contradicts: "The observation establishes facts incompatible with the stated hypothesis for the same subject and scope.",
        unrelated: "The observation concerns a different subject or topic and does not address the hypothesis.",
        insufficient: "The observation addresses the subject but does not establish or contradict the hypothesis. Correlation, speculation, repeated delivery, or missing evidence alone is not proof.",
    },
} as const;
export type SemanticLabel = keyof typeof SEMANTIC_CRITERIA.outcome | keyof typeof SEMANTIC_CRITERIA.evidence;
export interface SemanticStage { objective: string; samples: { text: string; expected: SemanticLabel }[] }
export interface SemanticWorkflow { id: SemanticMode; stages: SemanticStage[] }
const sample = (expected: SemanticLabel, text: string) => ({ expected, text });

export const semanticWorkflows: SemanticWorkflow[] = [
    { id: "outcome", stages: [
        { objective: "Apply both requested changes: update the account address and update its delivery preference.", samples: [
            sample("completed", "The address and delivery preference were committed in one transaction. The completion email could not be sent afterward; the ledger confirms that the transaction was not rolled back."),
            sample("unknown", "The client sent both changes and then lost its connection while waiting for a response. No transaction lookup has been performed. The dashboard currently displays an empty response field."),
            sample("not_applied", "Validation rejected the delivery preference before the transaction opened. The handler returned the proposed address in its error payload as a preview; neither field was written."),
            sample("partial", "The address writer finished and its new value is visible. The preference writer was never reached because a later lookup failed. This path does not roll back the earlier address write."),
            sample("unknown", "The endpoint acknowledged receipt and assigned a tracking number. The asynchronous worker has not reported a terminal state, and the materialized account record has not been read."),
            sample("completed", "Both new values are visible in the authoritative account store. A read replica still displays the earlier address because replication is delayed; that replica is not the source of truth."),
            sample("partial", "The response says the request was handled, but its detail section confirms only the delivery preference was saved. The address was skipped because the supplied postal district was unavailable."),
            sample("not_applied", "An address write was attempted inside the transaction. The preference write failed, the entire transaction rolled back, and a subsequent authoritative read confirms both original values remain."),
        ] },
        { objective: "Import all three submitted records into the destination dataset.", samples: [
            sample("partial", "The importer persisted the first and third submitted records. It quarantined the middle record for an unresolved mapping. Quarantined rows are not part of the destination dataset."),
            sample("not_applied", "The job generated a preview containing all three records. It was running in dry-run mode, and the storage adapter recorded no writes. The preview banner uses the word imported for display only."),
            sample("completed", "The destination contains all three submitted records, each linked to this job. Building the optional search index then failed. The indexing failure did not revert any imported record."),
            sample("unknown", "The upload completed and the job entered the worker queue. A browser refresh lost the progress page. The upload receipt confirms bytes received, but contains no import result."),
            sample("not_applied", "All rows were staged, but the final atomic commit was rejected. The transaction manager confirmed rollback of the staging operation and the destination contains none of these rows."),
            sample("partial", "The first record was accepted. The other two were written to an error report rather than the destination. The wrapper exited normally because producing that report counts as a handled run."),
            sample("unknown", "The worker stopped responding after opening the batch. Monitoring has no final status. The destination cannot currently be queried, so the report does not establish how many rows were persisted."),
            sample("completed", "A reconciliation query finds every submitted record in the destination. The client had displayed a timeout while waiting for acknowledgement, but the query is from the authoritative store after the commit."),
        ] },
        { objective: "Make the requested release available to readers in both target regions.", samples: [
            sample("unknown", "The deployment service accepted the release and marked it scheduled. Neither target region has reported activation. Artifact upload success is the last event currently available."),
            sample("completed", "Fresh reader probes in both target regions return the requested release identifier. A separate archive cleanup job failed afterward; the serving configuration remains on the new release."),
            sample("partial", "Readers in the eastern target region receive the new release. The western target region remains pinned to the previous version while a capacity change is pending."),
            sample("not_applied", "The rollout briefly started, then a health check triggered rollback everywhere. Current probes from both target regions confirm the old release; neither serves the requested version."),
            sample("completed", "The deploy command lost its response channel, but independent live probes now confirm the requested release in each target region. Those probes ran after activation, not against build artifacts."),
            sample("not_applied", "The release artifact was built and uploaded. Policy validation stopped the process before any region changed its serving pointer. Both target regions still use their prior release."),
            sample("unknown", "The control plane reports that activation was requested for both targets. Reader probes are unavailable during a monitoring outage. There is no confirmation that either serving pointer changed."),
            sample("partial", "The western target completed activation and readers there see the new release. The eastern target failed activation and kept the old pointer. Successful artifact replication to both regions did not activate the eastern one."),
        ] },
    ] },
    { id: "evidence", stages: [
        { objective: "For the request described by this observation, the account update was applied more than once.", samples: [
            sample("insufficient", "Two completion notifications carry the same request ID. The notification system redelivers messages when acknowledgements are lost. This observation includes no account-update ledger entries."),
            sample("supports", "The authoritative write ledger contains two distinct committed updates with the same request ID. One belongs to the initial attempt and the other to its retry; neither entry was rolled back."),
            sample("unrelated", "A nightly catalog rebuild produced duplicate search hits. Its records belong to a product index, not account updates, and the rebuild trace contains no account request identifier."),
            sample("contradicts", "The complete ledger for this request contains one committed update. The retry reused the stored result, and the audit confirms it performed no additional account write."),
            sample("supports", "An audit linked the initial attempt and its replay to the same request. Each incremented the account revision in a separately committed write, so the replay was not merely a duplicate notification."),
            sample("unrelated", "The delivery service retried an email twice after a provider outage. This trace describes a different notification-only request and includes no event from the account-update request in question."),
            sample("contradicts", "Both execution attempts for the request were rejected before mutation. The authoritative audit covers the entire request lifetime and records zero applied account changes."),
            sample("insufficient", "The operator suspects duplicate application because the browser displayed two success banners. The request ledger has not been retrieved, and both banners could have come from the same response."),
        ] },
        { objective: "The described request failed because the server rejected its credentials.", samples: [
            sample("contradicts", "The request trace confirms authentication succeeded and identifies the accepted principal. The same request then failed because its payload omitted a required field; the validator ran after authentication."),
            sample("unrelated", "A build worker could not download a compiler package. This is a separate build trace and contains no authentication result for the application request being investigated."),
            sample("insufficient", "The client saw an access-related message from an intermediary. There is no origin-server trace, and the intermediary may have generated that page without sending the request upstream."),
            sample("supports", "The origin authentication audit marks this request rejected because its supplied credential had expired. Request handling stopped at that check, before payload validation or any application operation."),
            sample("unrelated", "A document describes how credentials should be rotated during routine maintenance. It contains no event or observation from the request whose failure is under investigation."),
            sample("supports", "The server compared the presented credential with its verifier, recorded a mismatch for this request, and terminated processing at the credential-validation step. The failure report links directly to that audit entry."),
            sample("contradicts", "The authenticated handler accepted this request under a valid principal. It failed later while acquiring a database connection. The trace confirms the credential check had already passed."),
            sample("insufficient", "The response body contains a generic unauthorized-looking banner, but the application sometimes uses the same page for several errors. No credential-validation result is present in the supplied observation."),
        ] },
        { objective: "For the operation described, retrying did not create any additional destination records.", samples: [
            sample("supports", "The authoritative audit isolates the initial attempt and its retry. The initial attempt created one destination record; the retry resolved the existing record and issued no insert. The final record count for this operation remains one."),
            sample("insufficient", "The retry returned the same visible record identifier as the first response. No destination query or write audit was captured, so the observation cannot exclude an additional hidden record."),
            sample("contradicts", "A write trace shows the retry inserting a new destination record with a different internal identifier. Both the initial record and the retry-created record remain present and belong to this operation."),
            sample("unrelated", "An image-processing batch retried an unrelated thumbnail job. Its output directory and trace identifiers have no connection to the destination operation being investigated."),
            sample("insufficient", "A retry-safe flag is enabled in the configuration, and the operator expects deduplication. The observation includes no execution audit or resulting record state for this particular operation."),
            sample("supports", "A complete before-and-after comparison of the destination shows no record added by the retry. Its execution audit confirms it only read and returned the previously committed record for this operation."),
            sample("unrelated", "A tutorial explains how idempotency keys normally prevent duplicate records. It makes no claim about whether this operation used such a key or what its retry actually wrote."),
            sample("contradicts", "The retry committed another insert for the same logical operation because the original key was absent from its lookup. A subsequent destination inspection found both records, with neither removed."),
        ] },
    ] },
];

export function observationBatch(stage: SemanticStage) {
    return { objective: stage.objective, observations: stage.samples.map((sample, index) => ({ id: `item-${index + 1}`, text: sample.text })) };
}
export function expectedLabels(stage: SemanticStage): Record<string, SemanticLabel> {
    return Object.fromEntries(stage.samples.map((sample, index) => [`item-${index + 1}`, sample.expected]));
}
export function gradeLabels(stage: SemanticStage, value: unknown) {
    const expected = expectedLabels(stage);
    const entries = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const parsed = entries as Record<string, unknown>;
    const correct = Object.entries(expected).filter(([id, label]) => parsed[id] === label).length;
    return { correct, total: stage.samples.length, exact: correct === stage.samples.length && Object.keys(parsed).length === stage.samples.length };
}
