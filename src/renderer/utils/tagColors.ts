interface TagColorSource {
  name: string;
  color?: string | null;
}

export function buildTagColorMap(tags: TagColorSource[] | null | undefined): Map<string, string> {
  const colorMap = new Map<string, string>();

  for (const tag of tags ?? []) {
    if (tag.color) {
      colorMap.set(tag.name, tag.color);
    }
  }

  return colorMap;
}

export async function loadTagColorMap(): Promise<Map<string, string>> {
  const allTagsData = await window.electronAPI?.tags?.getAll?.();
  return buildTagColorMap(allTagsData as TagColorSource[] | null | undefined);
}