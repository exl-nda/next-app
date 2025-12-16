import { PdfViewerStore } from "../app/pdf-viewer/pdfViewerStore";

export class RootStore {
    pdfViewerStore: PdfViewerStore;

    constructor() {
        this.pdfViewerStore = new PdfViewerStore();
    }
}

export const rootStore = new RootStore();

