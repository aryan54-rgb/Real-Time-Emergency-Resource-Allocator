import { HospitalDashboard } from './HospitalDashboard';

export default async function HospitalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HospitalDashboard hospitalId={id} />;
}
