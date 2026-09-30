"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/session";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    api
      .me()
      .then((me) => router.replace(homeFor(me.role)))
      .catch(() => router.replace("/login"));
  }, [router]);

  return <Loading />;
}
