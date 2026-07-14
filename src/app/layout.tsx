import type { Metadata } from "next";
import { DotGothic16 } from "next/font/google";
import "./globals.css";

const dotGothic = DotGothic16({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-dot",
});

export const metadata: Metadata = {
  title: "Agent Office",
  description: "AI社員が働くバーチャルオフィス",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${dotGothic.variable} h-full`}>
      <body className="h-full font-[family-name:var(--font-dot)]">
        {children}
      </body>
    </html>
  );
}
