export const ROLE_OPTIONS = [
  { title: 'Research professional staff (coordinators, assistants, associates)', value: 'research_staff' },
  { title: 'Physician', value: 'physician' },
  { title: 'Nurse practitioner', value: 'nurse_practitioner' },
  { title: 'Physician assistant', value: 'physician_assistant' },
  { title: 'Specialty fellow/resident', value: 'fellow_resident_specialty' },
  { title: 'Nurse', value: 'nurse' },
  { title: 'Clinical coordinator', value: 'clinical_coordinator' },
  { title: 'Pharmacist', value: 'pharmacist' },
  { title: 'Dietitian', value: 'dietitian' },
  { title: 'Social worker', value: 'social_worker' },
  { title: 'Administrative staff', value: 'administrator' },
  { title: 'Other', value: 'other' }
]

export const SPECIALTY_OPTIONS = [
  { title: 'Nephrology', value: 'nephrology' },
  { title: 'Primary care / Family medicine', value: 'primary_care' },
  { title: 'General internal medicine', value: 'general_internal_medicine' },
  { title: 'Cardiology', value: 'cardiology' },
  { title: 'Endocrinology', value: 'endocrinology' },
  { title: 'Gastroenterology', value: 'gastroenterology' },
  { title: 'Geriatrics', value: 'geriatrics' },
  { title: 'Urology', value: 'urology' },
  { title: 'Anesthesiology', value: 'anesthesiology' },
  { title: 'Genetics', value: 'genetics' },
  { title: 'Surgery', value: 'surgery' },
  { title: 'Other', value: 'other' }
]

export const INTEREST_AREA_OPTIONS = [
  { title: 'All areas', value: 'all' },
  { title: 'Glomerulonephritis', value: 'glomerulonephritis' },
  { title: 'Pre-dialysis CKD', value: 'pre_dialysis_ckd' },
  { title: 'Acute kidney injury', value: 'acute_kidney_injury' },
  { title: 'Polycystic kidney disease', value: 'polycystic_kidney_disease' },
  { title: 'Genetic kidney diseases', value: 'genetic_kidney_diseases' },
  { title: 'Hemodialysis', value: 'hemodialysis' },
  { title: 'Peritoneal dialysis', value: 'peritoneal_dialysis' },
  { title: 'Transplant – eligibility and preparation', value: 'transplant_eligibility_preparation' },
  { title: 'Transplant – perioperative', value: 'transplant_perioperative' },
  { title: 'Transplant – post-transplant care', value: 'transplant_post_transplant_care' },
  { title: 'Dialysis vascular access', value: 'dialysis_vascular_access' },
  { title: 'Onconephrology', value: 'onconephrology' },
  { title: 'Perioperative care (non-transplant)', value: 'perioperative_care_non_transplant' },
]

export const CORRESPONDENCE_OPTIONS = [
  { title: 'Regular updates on active studies relevant to your profile', value: 'study_updates' },
  { title: 'Occasional newsletter', value: 'newsletter' }
]

export const ROLE_VALUES = new Set(ROLE_OPTIONS.map((role) => role.value))
export const SPECIALTY_VALUES = new Set(SPECIALTY_OPTIONS.map((item) => item.value))
export const INTEREST_AREA_VALUES = new Set(INTEREST_AREA_OPTIONS.map((item) => item.value))
export const CORRESPONDENCE_VALUES = new Set(CORRESPONDENCE_OPTIONS.map((item) => item.value))
export const THERAPEUTIC_AREA_OPTIONS = INTEREST_AREA_OPTIONS.filter((item) => item.value !== 'all')
