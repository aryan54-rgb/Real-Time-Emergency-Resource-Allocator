import { AmbulanceView } from './AmbulanceView';

export default async function AmbulancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AmbulanceView caseId={id} />;
}
