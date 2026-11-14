import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Flame in Freefall — microgravity fire safety insights",
  description: "Summarizes, ranks and interprets NASA microgravity combustion data for spacecraft fire safety.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
