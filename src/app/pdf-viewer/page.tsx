"use client";
import dynamic from "next/dynamic";

const PdfViewerClient = dynamic(() => import("@/app/pdf-viewer/PdfViewerClient"), { ssr: false });

export default function PdfViewerPage() {
    return <PdfViewerClient file="https://pub-02869a17e9a94d6b962a940063726697.r2.dev/sample.pdf" />;
}



