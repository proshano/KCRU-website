export const ROLE_OPTIONS = [
  { title: 'Administrator', value: 'administrator' },
  { title: 'Research professional staff (coordinators, assistants, associates)', value: 'research_staff' },
  { title: 'Clinical coordinator', value: 'clinical_coordinator' },
  { title: 'Physician (non-nephrologist)', value: 'physician_other' },
  { title: 'Fellow (other specialty)', value: 'fellow_other' },
  { title: 'Resident', value: 'resident' },
  { title: 'Medical student', value: 'medical_student' },
  { title: 'Physician assistant', value: 'physician_assistant' },
  { title: 'Registered nurse', value: 'nurse_registered' },
  { title: 'Nurse practitioner', value: 'nurse_practitioner' },
  { title: 'Nephrologist (not further specified)', value: 'nephrologist' },
  { title: 'Nephrology Fellow', value: 'fellow_nephrology' },
  { title: 'Transplant Nephrologist', value: 'transplant_nephrologist' },
  { title: 'Transplant Fellow', value: 'fellow_transplant' },
  { title: 'Transplant Clinic Nurse', value: 'nurse_transplant' },
  { title: 'Transplant Pharmacist', value: 'pharmacist_transplant' },
  { title: 'GN Clinic Nephrologist', value: 'nephrologist_gn' },
  { title: 'GN Fellow', value: 'fellow_gn' },
  { title: 'GN Clinic Nurse', value: 'nurse_gn' },
  { title: 'GN Clinic Pharmacist', value: 'pharmacist_gn' },
  { title: 'Hemodialysis nurse', value: 'nurse_dialysis' },
  { title: 'PD nurse', value: 'nurse_pd' },
  { title: 'Clinical pharmacist (not further specified)', value: 'pharmacist' },
  { title: 'Dietitian', value: 'dietitian' },
  { title: 'Social Worker', value: 'social_worker' },
  { title: 'Surgeon', value: 'surgeon' },
  { title: 'Other', value: 'other' }
]

export const TOPIC_OPTIONS = [
  { title: 'Study updates', value: 'study_updates' },
  { title: 'Publication updates', value: 'publication_updates' }
]

export const ROLE_VALUES = new Set(ROLE_OPTIONS.map((role) => role.value))
export const TOPIC_VALUES = new Set(TOPIC_OPTIONS.map((topic) => topic.value))
