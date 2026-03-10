import { Share_Tech_Mono } from "next/font/google";
import "./globals.css";

const shareTechMono = Share_Tech_Mono({
  weight: "400",
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "JETRACER // COMMAND CONSOLE",
  description: "Control dashboard for JetRacer robot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${shareTechMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
