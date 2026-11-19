import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import type { CourseForHandout } from './course-source';

/**
 * Loads a course for a handout, only if it belongs to `ownerId`.
 *
 * Upstream's document store reads a course by id for anyone who holds the id
 * (that is how a shared course opens) and lists only the owner's own. A handout
 * copies the whole text of a course into the owner's files, so the id has to be
 * in the owner's own list first: an id from somewhere else is "not found".
 */
export async function loadOwnedCourse(
  ownerId: string,
  courseId: string,
): Promise<CourseForHandout | null> {
  const store = await getOwnerScopedDocumentStore(ownerId);
  const owned = (await store.listDocuments()).some((summary) => summary.id === courseId);
  if (!owned) return null;
  const document = await store.loadDocument(courseId);
  if (!document) return null;
  return {
    name: document.stage.name,
    description: document.stage.description,
    scenes: document.scenes,
  };
}
