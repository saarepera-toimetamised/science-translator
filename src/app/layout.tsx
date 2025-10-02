import type { Metadata } from "next";  
import "./globals.css";  
  
export const metadata: Metadata = {  
  title: "Science Translator",  
  description: "Translate scientific articles from English to Estonian",  
  icons: {  
    icon: [{  
      url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">🌐</text></svg>',  
      type: 'image/svg+xml',  
    }],  
  },  
};  
  
export default function RootLayout({  
  children,  
}: {  
  children: React.ReactNode;  
}) {  
  return (  
    <html lang="en">  
      <body>{children}</body>  
    </html>  
  );  
}  
