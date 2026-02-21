export interface CreateAndFocusPostOptions {
  createPost: (input: {
    title: string;
    content: string;
    tags: string[];
    categories: string[];
  }) => Promise<{ id: string } | null | undefined>;
  setSelectedPost: (postId: string) => void;
  ensurePostsSidebar?: () => void;
  onError?: (error: unknown) => void;
}

export async function createAndFocusPost(options: CreateAndFocusPostOptions): Promise<string | null> {
  try {
    const post = await options.createPost({
      title: '',
      content: '',
      tags: [],
      categories: [],
    });

    if (!post) {
      return null;
    }

    options.setSelectedPost(post.id);
    options.ensurePostsSidebar?.();
    return post.id;
  } catch (error) {
    options.onError?.(error);
    return null;
  }
}
