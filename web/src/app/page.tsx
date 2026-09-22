"use client";

import Desk from "@/components/Desk/Desk";
import { useFeed } from "@/lib/useFeed";

/** Trader dry-run API (secondary). Override with NEXT_PUBLIC_API_URL. */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");
/** Multi-desk HTTP/SSE (primary). Override with NEXT_PUBLIC_DESK_URL. */
const DESK_URL = (process.env.NEXT_PUBLIC_DESK_URL ?? "http://127.0.0.1:3020").replace(/\/+$/, "");

export default function Page() {
  const feed = useFeed(API_URL);
  return <Desk feed={feed} apiUrl={API_URL} deskUrl={DESK_URL} />;
}
