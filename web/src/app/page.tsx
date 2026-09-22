"use client";

import Desk from "@/components/Desk/Desk";
import { useBtc } from "@/lib/useBtc";
import { useFeed } from "@/lib/useFeed";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3010";

export default function Page() {
  const feed = useFeed(API_URL);
  const btc = useBtc();
  return <Desk feed={feed} btc={btc} />;
}
