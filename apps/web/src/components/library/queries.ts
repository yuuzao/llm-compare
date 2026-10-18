import type { LibraryItemView, Page } from "@llm-compare/shared"
import { useInfiniteQuery } from "@tanstack/react-query"
import { api, qs } from "@/lib/api"

export const libraryKey = ["library-items"] as const
export function useLibrary(
  kind: "material" | "prompt",
  query: string,
  includeDeleted = false
) {
  return useInfiniteQuery({
    queryKey: [...libraryKey, kind, query, includeDeleted],
    queryFn: ({ pageParam }) =>
      api.get<Page<LibraryItemView>>(
        `/library-items${qs({ kind, query, include_deleted: includeDeleted ? "true" : undefined, cursor: pageParam, limit: 30 })}`
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
