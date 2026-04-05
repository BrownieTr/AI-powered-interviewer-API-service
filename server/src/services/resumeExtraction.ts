import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const MAX_RESUME_TEXT = 48_000;

export class ResumeParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ResumeParseError";
    }
}

function normalizeText(input: string): string {
    return input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getExtension(filename: string): string {
    return path.extname(filename).toLowerCase();
}

function isPlainText(ext: string, mime: string): boolean {
    return ext === ".txt" || mime === "text/plain";
}

function isPdf(ext: string, mime: string): boolean {
    return ext === ".pdf" || mime === "application/pdf";
}

function isDocx(ext: string, mime: string): boolean {
    return (
        ext === ".docx" ||
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
}

export async function extractResumeText(file: Express.Multer.File): Promise<string> {
    const ext = getExtension(file.originalname);
    let raw = "";

    if (isPdf(ext, file.mimetype)) {
        const parser = new PDFParse({ data: file.buffer });
        try {
        const out = await parser.getText();
        raw = out.text ?? "";
        } finally {
        await parser.destroy();
        }
    } else if (isDocx(ext, file.mimetype)) {
        const out = await mammoth.extractRawText({ buffer: file.buffer });
        raw = out.value ?? "";
    } else if (isPlainText(ext, file.mimetype)) {
        raw = file.buffer.toString("utf8");
    } else {
        throw new ResumeParseError(
        "Unsupported resume file type. Please upload a PDF, DOCX, or TXT file."
        );
    }

    const text = normalizeText(raw);
    if (!text) {
        throw new ResumeParseError("Could not extract readable text from the uploaded resume file.");
    }
    if (text.length > MAX_RESUME_TEXT) {
        throw new ResumeParseError("Extracted resume text is too long. Please upload a shorter resume.");
    }
    return text;
}
