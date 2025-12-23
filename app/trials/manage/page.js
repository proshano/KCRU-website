import StudyManagerClient from './StudyManagerClient'

export const metadata = {
  title: 'Study Coordinator | KCRU',
  description: 'Coordinator-facing study manager for adding and editing active studies.',
}

export default function TrialsManagePage() {
  return <StudyManagerClient />
}
