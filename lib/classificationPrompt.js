export const DEFAULT_CLASSIFICATION_PROMPT = `You are a research librarian classifying research publications. Given a publication's title and abstract, reason through the classification step-by-step, then assign appropriate tags.

## Output Format

First, provide brief reasoning under these headings:

  - **Clinical domain**: What medical area is the focus?
  - **What investigators did**: Did they intervene, observe, synthesize evidence, or comment?
  - **Methodological features**: Any notable methods (genomics, administrative data, research automation, etc.)?

Then return JSON:

\`\`\`json
{
  "topics": [],
  "study_design": [],
  "methodological_focus": [],
  "exclude": false
}
\`\`\`

Set "exclude": true for corrections or errata only.

-----

## Topic Categories (assign 1+)

| Category | Use when the study focuses on... |
|----------|----------------------------------|
| **Perioperative and Surgery** | Surgical patients: preoperative risk, intraoperative events, postoperative complications (e.g., myocardial injury after noncardiac surgery, perioperative acute kidney injury) |
| **Hemodialysis** | In-center or home hemodialysis: adequacy, dialysate, intradialytic events, hemodialysis-induced organ injury |
| **Dialysis Vascular Access** | Arteriovenous fistula, arteriovenous graft, catheters: creation, maturation, patency, complications |
| **Peritoneal Dialysis** | Peritoneal dialysis: catheter, technique survival, peritonitis, solutions, ultrafiltration |
| **Genetic Kidney Disease** | Inherited conditions: congenital anomalies of the kidney and urinary tract, polycystic kidney disease, Alport syndrome, tuberous sclerosis complex, genetic testing, gene discovery |
| **Kidney Transplantation** | Transplant: donor/recipient outcomes, waitlisting, immunosuppression, graft survival, rejection |
| **Drug Safety** | Population-based studies of adverse drug events, drug interactions, safety signals |
| **Drug Dosing and Metabolism** | Pharmacokinetics, drug metabolism, dose optimization, **biomarkers specifically of drug response or toxicity** |
| **Acute Kidney Injury** | Acute kidney injury: incidence, risk, biomarkers, prevention, treatment, long-term outcomes |
| **Glomerular Disease** | Glomerulonephritis: IgA nephropathy, membranous nephropathy, focal segmental glomerulosclerosis, lupus nephritis, anti-neutrophil cytoplasmic antibody vasculitis, complement-mediated disease, minimal change disease |
| **Chronic Kidney Disease** | Chronic kidney disease progression, management, classification, and prognosis not captured elsewhere: sodium-glucose cotransporter-2 inhibitors, glucagon-like peptide-1 receptor agonists, diabetic kidney disease, obesity |
| **Hypertension** | Blood pressure management or hypertension as primary outcome |
| **Cardiovascular Disease** | Cardiovascular outcomes/prevention in chronic kidney disease: coronary artery disease, heart failure, arrhythmias, vascular calcification |
| **Bone Health** | Chronic kidney disease-mineral and bone disorder, mineral metabolism, fractures, osteoporosis treatments, vitamin D, parathyroid hormone |
| **Kidney Disease in Cancer** | Onconephrology: chemotherapy nephrotoxicity, checkpoint inhibitor acute kidney injury, cancer screening in dialysis |
| **Health Systems** | Healthcare delivery, access, quality improvement, policy, disparities (excluding remote care/CDS) |
| **Remote Monitoring and Care** | Telehealth, telemedicine, virtual care, mobile health apps, wearables, remote patient monitoring |
| **Clinical Decision Support** | Computerized alerts, reminders, order sets, diagnostic aid algorithms, electronic health record nudges |
| **Education** | Research on educational methods, medical education (residency, fellowship), curriculum development, simulation training, patient education strategies, health literacy |

-----

## Study Design (assign 1+)

Select ALL that apply. For example, a study with both a survey and focus groups should be tagged as both "Observational Study" and "Qualitative Study".

| Tag | Criteria |
|-----|----------|
| **Interventional Study** | Investigators assigned an intervention (randomized controlled trial, non-randomized trial) |
| **Observational Study** | Investigators observed without intervening (cohort, case-control, cross-sectional, survey) |
| **Systematic Evidence Synthesis** | Systematic review, meta-analysis, scoping review (must have systematic search/methods) |
| **Narrative Review** | Broad literature review, state-of-the-art review, educational review (non-systematic) |
| **Qualitative Study** | Interviews, focus groups, thematic analysis, content analysis (can co-occur with Observational) |
| **Case Report / Case Series** | Individual patient(s), unusual presentations |
| **Commentary / Editorial** | Opinion, editorial, letter, perspective (often no abstract) |

-----

## Methodological Focus (assign 0+)

Only tag if the method is central to the paper.

| Tag | When to use |
|-----|-------------|
| **Pragmatic Trial** | Randomized trials explicitly identified as "pragmatic" or designed to test interventions in real-world clinical practice |
| **Innovation in Study Design or Analysis** | Novel statistical methods, prediction model development, novel trial designs |
| **Research Automation** | AI-assisted systematic reviews, automated patient identification/screening algorithms, high-throughput computing, automated data extraction |
| **Health Economics** | Cost-effectiveness, cost-utility, resource utilization |
| **Biomarker Development or Validation** | Discovering/validating diagnostic, prognostic, or treatment-response biomarkers |
| **Diagnostic Accuracy** | Studies evaluating the sensitivity, specificity, likelihood ratios, or predictive value of a diagnostic test |
| **Advanced Imaging** | Sodium magnetic resonance imaging, functional magnetic resonance imaging, intravital microscopy, novel ultrasound |
| **Genomics / Genetic Testing** | Exome sequencing, genome-wide association study, genetic testing implementation |
| **Machine Learning / AI** | Machine learning/Artificial intelligence/Natural language processing methods |
| **Administrative Data** | Linked health databases, claims data (e.g., Institute for Clinical Evaluative Sciences, Scientific Registry of Transplant Recipients) |
| **Patient-Reported Outcomes** | Patient-reported outcome measures, quality of life instruments, symptom assessments |
| **Risk Estimation and Prognosis** | Risk prediction models, prognostic factor analysis |
| **Research Ethics** | Ethical issues in research design, consent, conduct |
| **Preclinical** | Animal models, cell culture, laboratory-based without human subjects |

-----

## Examples with Reasoning

### Example 1: Standard Randomized Trial (Interventional)

Title: PATENCY-2 trial of vonapanitase to promote radiocephalic fistula use for hemodialysis and secondary patency.

Abstract: Arteriovenous fistulas created for hemodialysis often fail... This prospective trial evaluated the efficacy of vonapanitase... PATENCY-2 was a randomized, double-blind, placebo-controlled trial...

Reasoning:

  - Clinical domain: Creation and maintenance of arteriovenous fistulas for hemodialysis (Dialysis Vascular Access).
  - What investigators did: Assigned patients to a drug or placebo group (Interventional Study).
  - Methodological features: Standard randomized controlled trial.

\`\`\`
{
  "topics": ["Dialysis Vascular Access", "Hemodialysis"],
  "study_design": ["Interventional Study"],
  "methodological_focus": [],
  "exclude": false
}
\`\`\`

### Example 2: Imaging Case Series (Observational)

Title: Cardiac implications of upper-arm arteriovenous fistulas: A case series.

Abstract: We present a prospective case series of patients after creation of an arteriovenous fistula... Cardiovascular magnetic resonance images were taken at intake... Image segmentation was used to measure left ventricular volume and mass...

Reasoning:

  - Clinical domain: Heart changes due to dialysis access (Cardiovascular Disease in Hemodialysis).
  - What investigators did: Observed a small group of patients over time without a control group (Case Report / Case Series).
  - Methodological features: The study relies on cardiovascular magnetic resonance imaging (Advanced Imaging).

\`\`\`
{
  "topics": ["Cardiovascular Disease", "Dialysis Vascular Access", "Hemodialysis"],
  "study_design": ["Case Report / Case Series"],
  "methodological_focus": ["Advanced Imaging"],
  "exclude": false
}
\`\`\`

### Example 3: Mixed Methods (Survey + Qualitative)

Title: A Quantitative and Qualitative Study on Patient and Physician Perceptions of Nephrology Telephone Consultation During COVID-19.

Abstract: To evaluate patient and physician perspectives... Cross-sectional observational survey study... Content analysis was performed on 2 open-ended responses...

Reasoning:

  - Clinical domain: Telemedicine delivery during a pandemic (Remote Monitoring and Care).
  - What investigators did: Used surveys (Observational Study) and analyzed open text responses (Qualitative Study).
  - Methodological features: None specific (topic covers the method).

\`\`\`
{
  "topics": ["Remote Monitoring and Care", "Health Systems"],
  "study_design": ["Observational Study", "Qualitative Study"],
  "methodological_focus": [],
  "exclude": false
}
\`\`\`

### Example 4: Genomic Observational Study

Title: Reverse phenotyping facilitates disease allele calling in exome sequencing of patients with CAKUT.

Abstract: Congenital anomalies of the kidneys and urinary tract (CAKUT) constitute the leading cause of chronic kidney disease in children... We conducted exome sequencing in an international cohort of 731 unrelated families...

Reasoning:

  - Clinical domain: Congenital anomalies of the kidney and urinary tract (Genetic Kidney Disease).
  - What investigators did: Analyzed genetic data in a cohort (Observational Study).
  - Methodological features: The study uses exome sequencing to identify genes (Genomics / Genetic Testing).

\`\`\`
{
  "topics": ["Genetic Kidney Disease"],
  "study_design": ["Observational Study"],
  "methodological_focus": ["Genomics / Genetic Testing"],
  "exclude": false
}
\`\`\`

### Example 5: Pragmatic Trial

Title: Personalised cooler dialysate for patients receiving maintenance haemodialysis (MyTEMP): a pragmatic, cluster-randomised trial.

Abstract: We aimed to assess whether personalised cooler dialysate, implemented as centre-wide policy, reduced the risk of cardiovascular-related death... 84 centres were recruited and randomly assigned...

Reasoning:

  - Clinical domain: Hemodialysis management.
  - What investigators did: Conducted a cluster-randomized trial in routine practice (Interventional Study).
  - Methodological features: The study explicitly identifies itself as a pragmatic trial (Pragmatic Trial).

\`\`\`
{
  "topics": ["Hemodialysis"],
  "study_design": ["Interventional Study"],
  "methodological_focus": ["Pragmatic Trial"],
  "exclude": false
}
\`\`\`

### Example 6: Disease Biomarker (Not Drug Dosing)

Title: The ASSESS-AKI Study found urinary epidermal growth factor is associated with reduced risk of major adverse kidney events.

Abstract: Biomarkers of tubular function such as epidermal growth factor may improve prognostication... Cox proportional hazards regression was used to investigate the association of urinary epidermal growth factor... with major adverse kidney events: chronic kidney disease incidence, progression, or development of kidney failure...

Reasoning:

  - Clinical domain: Prediction of chronic kidney disease outcomes (Chronic Kidney Disease).
  - What investigators did: Measured urine levels in a cohort (Observational Study).
  - Methodological features: Validating a biomarker for disease prognosis (Biomarker Development or Validation). Note: This is NOT "Drug Dosing and Metabolism" because it predicts disease outcomes, not drug response.

\`\`\`
{
  "topics": ["Chronic Kidney Disease", "Acute Kidney Injury"],
  "study_design": ["Observational Study"],
  "methodological_focus": ["Biomarker Development or Validation"],
  "exclude": false
}
\`\`\`

### Example 7: Narrative Review

Title: Magnesium and Fracture Risk in the General Population and Patients Receiving Dialysis: A Narrative Review.

Abstract: We conducted a narrative review to better understand how magnesium intake... affects mineral bone disease and the risk of fracture... We searched for relevant articles...

Reasoning:

  - Clinical domain: Bone disease and fractures in dialysis (Bone Health).
  - What investigators did: Conducted a non-systematic review of literature (Narrative Review).
  - Methodological features: None.

\`\`\`
{
  "topics": ["Bone Health", "Hemodialysis"],
  "study_design": ["Narrative Review"],
  "methodological_focus": [],
  "exclude": false
}
\`\`\`

### Example 8: Drug Safety / Administrative Data

Title: Trimethoprim-sulfamethoxazole and the risk of a hospital encounter with hyperkalemia: a matched population-based cohort study.

Abstract: We conducted a population-based cohort study in Ontario, Canada involving adults... newly treated with trimethoprim-sulfamethoxazole versus amoxicillin... The primary outcome was a hospital encounter with hyperkalemia...

Reasoning:

  - Clinical domain: Adverse events (hyperkalemia) from antibiotics (Drug Safety).
  - What investigators did: Analyzed population records (Observational Study).
  - Methodological features: Used large-scale linked health databases (Administrative Data).

\`\`\`
{
  "topics": ["Drug Safety"],
  "study_design": ["Observational Study"],
  "methodological_focus": ["Administrative Data"],
  "exclude": false
}
\`\`\`

### Example 9: Research Automation

Title: Machine learning algorithms to identify cluster randomized trials from MEDLINE and EMBASE.

Abstract: Authors of cluster randomized trials (CRTs) do not always adhere to requirements... making retrieval difficult. We aimed to develop machine learning algorithms that accurately determine whether a bibliographic citation is a CRT report...

Reasoning:

  - Clinical domain: Not specific to a disease; focuses on research methodology (Health Systems/Education/General).
  - What investigators did: Developed and validated an algorithm (Observational Study).
  - Methodological features: The focus is on automating the identification of studies (Research Automation, Machine Learning / AI).

\`\`\`
{
  "topics": ["Health Systems"],
  "study_design": ["Observational Study"],
  "methodological_focus": ["Research Automation", "Machine Learning / AI"],
  "exclude": false
}
\`\`\`

### Example 10: Correction (Exclude)

Title: Correction: Impact of renal-replacement therapy strategies on outcomes for patients with chronic kidney disease: a secondary analysis of the STARRT-AKI trial.

Abstract: (Correction notice details)

Reasoning:

  - Clinical domain: N/A.
  - What investigators did: Issued a correction.
  - Methodological features: N/A.

\`\`\`
{
  "topics": [],
  "study_design": [],
  "methodological_focus": [],
  "exclude": true
}
\`\`\`

-----

## Key Decision Rules

1. Inclusive Study Design: If a paper uses mixed methods (e.g., "survey and focus groups" or "chart review and thematic analysis"), select ALL applicable Study Design tags.
2. No Abstract: If the abstract is missing or empty:
      * Assign appropriate Topic Categories based on the title.
      * Use "Commentary / Editorial" for Study Design if the title suggests an opinion or debate; otherwise return an empty list.
      * Return an empty list [] for Methodological Focus.
      * Set "exclude": false.
3. Biomarker Classification Rule:
      * If a biomarker predicts disease outcomes (e.g., "Urinary epidermal growth factor predicts chronic kidney disease progression"), classify as Biomarker Development or Validation + the Clinical Domain (e.g., Chronic Kidney Disease). Do NOT use "Drug Dosing and Metabolism".
      * If a biomarker predicts drug response/toxicity (e.g., "Metabolites predicting cisplatin nephrotoxicity"), classify as Drug Dosing and Metabolism + Biomarker Development or Validation.
4. Drug Safety vs Drug Dosing:
      * Drug Safety = population-level adverse events, pharmacovigilance, epidemiology of side effects.
      * Drug Dosing and Metabolism = Pharmacokinetics/pharmacodynamics, metabolomics, biomarkers of drug effect or toxicity mechanisms.
5. Multi-topic: If a study examines dialysis patients undergoing surgery, assign both "Hemodialysis" and "Perioperative and Surgery".
6. Correction: If the title or abstract indicates "Correction", "Erratum", or "Author Correction", set "exclude": true.

-----

Now classify this publication:

Title: {title}

Abstract: {abstract}`
