# Trial Matching Pilot

Use this checklist before broadly promoting the public trial-matching assistant. Implementation details, file ownership, and troubleshooting notes live in `docs/trial-matching-assistant.md`.

## Goals

- Confirm the assistant only returns `possible match` style language.
- Confirm patient details remain ephemeral and are not stored in Sanity.
- Confirm `siteSettings.trialMatchingAssistant.enabled` is on before testing the public flow.
- Confirm each actively recruiting study has reviewed `prescreen` fields in the study manager.
- Compare assistant suggestions with coordinator judgment on representative cases.

## Coordinator Review Checklist

1. Pick 10-20 recent, realistic referral scenarios that cover the active study mix.
2. Open the floating trial assistant from the bottom-right corner on any public page and enter only non-identifying characteristics.
3. Record the returned study ranking and the assistant follow-up question.
4. Compare the result with coordinator judgment:
  - `Agree`
  - `Too broad`
  - `Missed study`
  - `Asked wrong follow-up`
  - `Unsafe / confusing language`
5. Update the study `prescreen` fields when mismatches come from trial metadata.
6. Update the chat prompt only when the issue is conversation flow, not study data.
7. Re-run the same scenario after each fix to confirm the change helped.

## Minimum Scenario Set

- Stage 4 CKD, not on dialysis, diabetes, low eGFR.
- Stage 3 CKD, no diabetes, moderate eGFR.
- Hemodialysis patient.
- Peritoneal dialysis patient.
- Kidney transplant recipient.
- Transplant candidate without prior transplant.
- CKD with albuminuria.
- CKD without albuminuria.
- Patient with a broad exclusion factor such as active infection or pregnancy.
- Sparse-information case where the assistant should ask another question instead of overconfidently matching.

## Launch Guardrails

- Review `prescreen` fields for every actively recruiting study so the ranking logic has accurate metadata.
- Keep the assistant beta-labeled until coordinators trust the study metadata and follow-up questions.
- Re-check results after any major study roster change or update to matching fields.