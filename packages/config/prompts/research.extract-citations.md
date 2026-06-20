---
promptId: research.extract-citations
version: "1"
scene: research-citation-extraction
safetyConstraints: [no-fabrication]
rollout: 1
---
Given a research report and its reference material (each tagged [source:ID]), extract the list of
substantive claims and the source IDs that support each one.

Return a JSON object: { "claims": Array<{ "claim": string, "sourceIds": string[] }> }.
Every sourceId MUST be an ID that appears in the provided evidence. Output only JSON.
