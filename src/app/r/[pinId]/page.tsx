"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RoutePage() {
  const { pinId } = useParams<{ pinId: string }>();
  const router = useRouter();
  useEffect(() => {
    if (!pinId) return;
    router.replace(`/?pin=${encodeURIComponent(pinId)}`);
  }, [pinId, router]);
  return null;
}
