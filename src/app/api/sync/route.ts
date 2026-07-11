import { NextResponse } from "next/server";
import { syncAll } from "@/collector";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const result = await syncAll();
  return NextResponse.json(result);
}
