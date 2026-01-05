export const ROLE_OPTIONS = [
  { title: 'Clinical research professional staff (coordinators, assistants, associates)', value: 'research_staff' },
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
  { title: 'Non-clinical academic / researcher', value: 'nonclinical_academic' },
  { title: 'Community member', value: 'community_member' },
  { title: 'Patient or caregiver', value: 'patient_caregiver' },
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

export const CORRESPONDENCE_OPTIONS = [
  { title: 'Occasional news about our research programs and publications', value: 'newsletter' },
  { title: 'Regular updates about active studies', value: 'study_updates' }
]

export const ROLE_VALUES = new Set(ROLE_OPTIONS.map((role) => role.value))
export const SPECIALTY_VALUES = new Set(SPECIALTY_OPTIONS.map((item) => item.value))
export const CORRESPONDENCE_VALUES = new Set(CORRESPONDENCE_OPTIONS.map((item) => item.value))

export function getTherapeuticAreaLabel(value) {
  if (!value) return ''
  return String(value)
}
