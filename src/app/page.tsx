import OfficeCanvas from "@/components/OfficeCanvas";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { demo } = await searchParams;
  return (
    <main className="h-dvh w-full bg-[#1a1622]">
      <OfficeCanvas demo={demo !== undefined} />
    </main>
  );
}
