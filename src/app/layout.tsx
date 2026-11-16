import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({
  variable: "--font-plex",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

// 키 지문처럼 "글자 하나하나를 비교해야 하는 데이터"에만 쓴다
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "폴더 잠그기 | Pile Security",
  description:
    "폴더를 브라우저 안에서 암호화해 잠그고, 열쇠 파일이 있어야만 열 수 있게 합니다. 파일은 서버로 보내지 않습니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${plex.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
