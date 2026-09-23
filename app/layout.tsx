import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockPilot AI — Автономный агент пополнения",
  description: "Детерминированные рекомендации по пополнению склада",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
