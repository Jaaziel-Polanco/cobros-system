import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// Inter (subconjunto latin, fuente variable 100–900) servida desde el repo.
// Con `next/font/google` el build la descargaba en plena compilación, y en
// producción esa descarga no tiene timeout: una conexión colgada congela el
// build en el servidor. Es el mismo archivo que generaba next/font/google.
const inter = localFont({
  src: "./fonts/inter-latin-var.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inversiones Cordero | Gestión de Cobranza",
  description: "Plataforma de gestión de cuentas por cobrar para Inversiones Cordero",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
