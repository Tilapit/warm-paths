import { NextResponse } from "next/server";
import { applyProfileInput, readProfile, type ProfileInput } from "@/lib/profile.ts";

export async function GET() {
  return NextResponse.json(readProfile());
}

/** A change to the user's profile: fields replace, `add` and `remove` change lists, industries may be plain language. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as ProfileInput | null;
  if (!b || typeof b !== "object") return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json(applyProfileInput(b));
}
