"use client";
import dynamic from "next/dynamic";

const PdfViewerClient = dynamic(() => import("@/app/pdf-viewer/PdfViewerClient"), { ssr: false });

export default function PdfViewerPage() {
    return <PdfViewerClient />;
}



