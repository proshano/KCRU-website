# London Kidney Clinical Research website

This repository holds the code for [londonkidney.ca](https://londonkidney.ca), the website of the Kidney Clinical Research Unit (KCRU) in London, Ontario.

## What the site does

- **Publications.** Each morning the site finds new papers by the unit's investigators in PubMed and other databases. An AI model writes a short plain language summary of each one and tags it by topic, study type, and method. If it is unclear whether a paper belongs to one of the investigators, an administrator checks it first.
- **Studies.** Coordinators add studies through a web form that can copy details from ClinicalTrials.gov, and an administrator approves each one before it appears. A study has a team for each site that coordinates it (Victoria Hospital, University Hospital, St. Joseph's Health Care), each with its own investigator and contact, and lists where patients can be seen. Clinicians can refer a patient to a recruiting study by entering their own email address and, when more than one team takes referrals, choosing which team should reply. The form asks nothing about the patient.
- **Trial assistant.** Clinicians describe a patient in general terms in a chat window, and the assistant suggests recruiting studies that may fit. The study team confirms eligibility.
- **Email updates.** Subscribers can receive monthly updates on recruiting studies and occasional news about new publications.
- **Posts on X.** Staff can draft posts about new papers with AI help and schedule them through Buffer. Nothing is posted without staff approval.

## AI and privacy

- AI writes the publication summaries, tags, and search engine descriptions, which appear without review. It also drafts study summaries and posts on X, which staff review first, and it runs the trial assistant.
- The trial assistant does not save conversations, but it sends them to an outside AI service to generate replies.
- The site stores what people submit through its forms (subscriptions, contact messages, and referrals), with the sender's IP address and browser type. See the [privacy statement](https://londonkidney.ca/privacy).

## For staff

Staff edit content in Sanity Studio. Staff tools are at `/admin`, and coordinators manage studies at `/trials/manage`. Both use LHSC or St. Joseph's Microsoft sign-in. The mailing list, the lists of staff who can sign in, and the addresses that get notification emails are edited at `/admin/people`. Site Settings in Sanity holds the feature switches, email schedules, and AI settings.

## For developers

The site uses Next.js on Vercel, Sanity for content, Resend for email, and GitHub Actions for the daily jobs. To run it locally with Node.js 22:

```bash
npm install
npm run dev
```

Set `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET` in `.env.local`. Other features need their own keys. No automated checks run on pull requests, so run `npm run lint` and `npm test` before pushing. `AGENTS.md` is the detailed technical reference. `PROJECT_SPECIFICATION.md` is the original design brief and is out of date.
