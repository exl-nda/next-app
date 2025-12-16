import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");

    if (!url) {
        return NextResponse.json(
            { error: "Missing 'url' query parameter" },
            { status: 400 }
        );
    }

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
            },
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Failed to fetch PDF: ${response.status} ${response.statusText}` },
                { status: response.status }
            );
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        return new NextResponse(arrayBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="document.pdf"`,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Error fetching PDF:", error);
        return NextResponse.json(
            { error: "Failed to fetch PDF" },
            { status: 500 }
        );
    }
}
