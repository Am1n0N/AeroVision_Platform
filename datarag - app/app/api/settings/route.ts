// app/api/user/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prismadb from "@/lib/prismadb";
import { z } from "zod";

export const runtime = "nodejs";

const PatchSchema = z
    .object({
        id: z.string().optional(),
        userId: z.string().optional(),
        defaultModel: z.string().min(1).optional(),
        defaultTemperature: z.number().min(0).max(2).optional(),
        useDatabase: z.boolean().optional(),
        useKnowledgeBase: z.boolean().optional(),
        theme: z.enum(["light", "dark", "system"]).optional(),
        sidebarCollapsed: z.boolean().optional(),
        showTokenCount: z.boolean().optional(),
        showExecutionTime: z.boolean().optional(),
        showSourceReferences: z.boolean().optional(),
        maxContextLength: z.number().int().min(512).max(32000).optional(),
        rerankingThreshold: z.number().min(0).max(1).optional(),
        enableReranking: z.boolean().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
    })
    .strict();

function err(status: number, message: string, details?: unknown) {
    return NextResponse.json({ error: message, details }, { status });
}

/**
 * GET /api/user/settings
 * - Returns the user's settings.
 * - If none exist yet, creates a row with model defaults and returns it.
 */
export async function GET(_: NextRequest) {
    try {
        const { userId } = auth();
        if (!userId) return err(401, "Authentication required");

        const settings = await prismadb.userSettings.upsert({
            where: { userId },
            update: {},
            create: { userId },
        });

        return NextResponse.json(settings, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        console.error("[UserSettings][GET]", e);
        return err(500, "Failed to fetch settings");
    }
}

/**
 * PATCH /api/user/settings
 * - Partially updates settings (only provided fields).
 * - Validates input and upserts if the row does not exist yet.
 */
export async function PATCH(req: NextRequest) {
    try {
        const { userId } = auth();
        if (!userId) return err(401, "Authentication required");

        const body = await req.json().catch(() => ({}));
        const parsed = PatchSchema.safeParse(body);
        if (!parsed.success) {
            return err(400, "Invalid payload", parsed.error.flatten());
        }

        const data = parsed.data;

        const updated = await prismadb.userSettings.upsert({
            where: { userId },
            create: { userId, ...data },
            update: { ...data },
        });

        return NextResponse.json(updated, { status: 200 });
    } catch (e) {
        console.error("[UserSettings][PATCH]", e);
        return err(500, "Failed to update settings");
    }
}

/**
 * OPTIONS /api/user/settings
 * - Useful for CORS preflight (if needed).
 */
export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
