"use client";

import { useEffect } from "react";
import { markNoticeRead } from "@/app/notice-actions/actions";

/** Records that the notice was opened (FR-52). Runs only when actually viewed, not on prefetch. */
export function MarkRead({ noticeId }: { noticeId: string }) {
  useEffect(() => {
    void markNoticeRead(noticeId);
  }, [noticeId]);
  return null;
}
