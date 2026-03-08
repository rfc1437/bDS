# API Documentation

Contract version: 1.15.0

This reference documents all Python runtime API calls available through `bds_api` in embedded Pyodide.

`bds_api` is available in **macro scripts** (executed during preview and page generation). Import `bds` and call API methods from an `async def` entrypoint. Transform scripts do not have access to `bds_api`.

## Usage

```python
from bds_api import bds

# inside an async Python function in bDS runtime:
project = await bds.meta.get_project_metadata()
```

## Table of contents

- [projects](#projects)
- [posts](#posts)
- [media](#media)
- [scripts](#scripts)
- [templates](#templates)
- [tasks](#tasks)
- [app](#app)
- [meta](#meta)
- [tags](#tags)
- [chat](#chat)
- [sync](#sync)
- [publish](#publish)
- [embeddings](#embeddings)
- [Data Structures](#data-structures)

## projects

**Module APIs**

- [projects.create](#projectscreate)
- [projects.update](#projectsupdate)
- [projects.delete](#projectsdelete)
- [projects.deleteWithData](#projectsdeletewithdata)
- [projects.get](#projectsget)
- [projects.getAll](#projectsgetall)
- [projects.getActive](#projectsgetactive)
- [projects.setActive](#projectssetactive)

### projects.create

Create a project.

**Parameters**

- data (dict, required)

**Response specification**

- Return type: `ProjectData`
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.create(data={})
```

**Example response**

```python
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### projects.update

Update a project by id.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `ProjectData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.update(id='id-1', data={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### projects.delete

Delete a project by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.projects.delete(id='id-1')
```

**Example response**

```python
True
```

### projects.deleteWithData

Delete a project and data by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.projects.delete_with_data(id='id-1')
```

**Example response**

```python
True
```

### projects.get

Fetch one project by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `ProjectData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.get(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### projects.getAll

Fetch all projects.

**Parameters**

- None

**Response specification**

- Return type: `ProjectData[]`
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.get_all()
```

**Example response**

```python
[
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
]
```

### projects.getActive

Fetch active project.

**Parameters**

- None

**Response specification**

- Return type: `ProjectData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.get_active()
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### projects.setActive

Set active project by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `ProjectData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectData`

**Example call**

```python
from bds_api import bds
result = await bds.projects.set_active(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'name': 'value',
    'slug': 'value',
    'description': 'value',
    'dataPath': 'value',
    'isActive': False,
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

[↑ Back to Table of contents](#table-of-contents)

## posts

**Module APIs**

- [posts.create](#postscreate)
- [posts.update](#postsupdate)
- [posts.delete](#postsdelete)
- [posts.get](#postsget)
- [posts.getBySlug](#postsgetbyslug)
- [posts.getPreviewUrl](#postsgetpreviewurl)
- [posts.getAll](#postsgetall)
- [posts.getByStatus](#postsgetbystatus)
- [posts.publish](#postspublish)
- [posts.getTranslation](#postsgettranslation)
- [posts.getTranslations](#postsgettranslations)
- [posts.publishTranslation](#postspublishtranslation)
- [posts.discard](#postsdiscard)
- [posts.hasPublishedVersion](#postshaspublishedversion)
- [posts.rebuildFromFiles](#postsrebuildfromfiles)
- [posts.reindexText](#postsreindextext)
- [posts.search](#postssearch)
- [posts.filter](#postsfilter)
- [posts.getTags](#postsgettags)
- [posts.getCategories](#postsgetcategories)
- [posts.getByYearMonth](#postsgetbyyearmonth)
- [posts.getDashboardStats](#postsgetdashboardstats)
- [posts.getTagsWithCounts](#postsgettagswithcounts)
- [posts.getCategoriesWithCounts](#postsgetcategorieswithcounts)
- [posts.getLinksTo](#postsgetlinksto)
- [posts.getLinkedBy](#postsgetlinkedby)
- [posts.rebuildLinks](#postsrebuildlinks)
- [posts.isSlugAvailable](#postsisslugavailable)
- [posts.generateUniqueSlug](#postsgenerateuniqueslug)

### posts.create

Create a post.

**Parameters**

- data (dict, required)

**Response specification**

- Return type: `PostData`
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.create(data={})
```

**Example response**

```python
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.update

Update a post by id.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `PostData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.update(id='id-1', data={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.delete

Delete a post by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.posts.delete(id='id-1')
```

**Example response**

```python
True
```

### posts.get

Fetch one post by id.

**Parameters**

- postId (str, required)

**Response specification**

- Return type: `PostData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get(post_id='post-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.getBySlug

Fetch one post by slug.

**Parameters**

- slug (str, required)

**Response specification**

- Return type: `PostData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_by_slug(slug='slug')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.getPreviewUrl

Get preview URL for post. options may include draft=true and lang=<language-code>.

**Parameters**

- id (str, required)
- options (dict, optional)

**Response specification**

- Return type: `string | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_preview_url(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### posts.getAll

Fetch posts with pagination.

**Parameters**

- options (dict, optional)

**Response specification**

- Return type: `PaginatedPostsResult`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_all()
```

**Example response**

```python
{}
```

### posts.getByStatus

Fetch posts by status.

**Parameters**

- status (str, required)

**Response specification**

- Return type: `PostData[]`
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_by_status(status='status')
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
]
```

### posts.publish

Publish a post by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `PostData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.publish(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.getTranslation

Get a single translation for a post by language.

**Parameters**

- postId (str, required)
- language (str, required)

**Response specification**

- Return type: `PostTranslationData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostTranslationData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_translation(post_id='post-1', language='language')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'translationFor': 'value',
    'language': 'value',
    'title': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'filePath': 'value'
}
```

### posts.getTranslations

Get all translations for a post.

**Parameters**

- postId (str, required)

**Response specification**

- Return type: `PostTranslationData[]`
- Data structures: `PostTranslationData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_translations(post_id='post-1')
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'translationFor': 'value',
    'language': 'value',
    'title': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'filePath': 'value'
}
]
```

### posts.publishTranslation

Publish a specific translation of a post.

**Parameters**

- postId (str, required)
- language (str, required)

**Response specification**

- Return type: `PostTranslationData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostTranslationData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.publish_translation(post_id='post-1', language='language')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'translationFor': 'value',
    'language': 'value',
    'title': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'filePath': 'value'
}
```

### posts.discard

Discard draft changes for post.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `PostData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.discard(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
```

### posts.hasPublishedVersion

Check if post has published version.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.posts.has_published_version(id='id-1')
```

**Example response**

```python
True
```

### posts.rebuildFromFiles

Rebuild posts database from files.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.posts.rebuild_from_files()
```

**Example response**

```python
None
```

### posts.reindexText

Reindex post search text.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.posts.reindex_text()
```

**Example response**

```python
None
```

### posts.search

Search posts by free-text query.

**Parameters**

- query (str, required)

**Response specification**

- Return type: `SearchResult[]`

**Example call**

```python
from bds_api import bds
result = await bds.posts.search(query='search phrase')
```

**Example response**

```python
[]
```

### posts.filter

Filter posts by criteria, including optional language and missingTranslationLanguage filters.

**Parameters**

- filter (dict, required)

**Response specification**

- Return type: `PostData[]`
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.filter(filter={})
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
]
```

### posts.getTags

Get all post tags.

**Parameters**

- None

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_tags()
```

**Example response**

```python
[]
```

### posts.getCategories

Get all post categories.

**Parameters**

- None

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_categories()
```

**Example response**

```python
[]
```

### posts.getByYearMonth

Get post counts grouped by year/month.

**Parameters**

- None

**Response specification**

- Return type: `Array<{ year: number; month: number; count: number } >`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_by_year_month()
```

**Example response**

```python
[]
```

### posts.getDashboardStats

Get post dashboard stats.

**Parameters**

- None

**Response specification**

- Return type: `DashboardStats`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_dashboard_stats()
```

**Example response**

```python
{}
```

### posts.getTagsWithCounts

Get post tags with counts.

**Parameters**

- None

**Response specification**

- Return type: `TagCount[]`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_tags_with_counts()
```

**Example response**

```python
[]
```

### posts.getCategoriesWithCounts

Get post categories with counts.

**Parameters**

- None

**Response specification**

- Return type: `CategoryCount[]`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_categories_with_counts()
```

**Example response**

```python
[]
```

### posts.getLinksTo

Get posts linked to given post.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `PostData[]`
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_links_to(id='id-1')
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
]
```

### posts.getLinkedBy

Get posts linking to given post.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `PostData[]`
- Data structures: `PostData`

**Example call**

```python
from bds_api import bds
result = await bds.posts.get_linked_by(id='id-1')
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'title': 'value',
    'slug': 'value',
    'excerpt': 'value',
    'content': 'value',
    'status': 'draft',
    'author': 'value',
    'language': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value',
    'availableLanguages': 'value'
}
]
```

### posts.rebuildLinks

Rebuild post link graph.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.posts.rebuild_links()
```

**Example response**

```python
None
```

### posts.isSlugAvailable

Check if post slug is available.

**Parameters**

- slug (str, required)
- excludePostId (str, optional)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.posts.is_slug_available(slug='slug')
```

**Example response**

```python
True
```

### posts.generateUniqueSlug

Generate unique slug from title.

**Parameters**

- title (str, required)
- excludePostId (str, optional)

**Response specification**

- Return type: `string`

**Example call**

```python
from bds_api import bds
result = await bds.posts.generate_unique_slug(title='title')
```

**Example response**

```python
'value'
```

[↑ Back to Table of contents](#table-of-contents)

## media

**Module APIs**

- [media.import](#mediaimport)
- [media.update](#mediaupdate)
- [media.replaceFile](#mediareplacefile)
- [media.delete](#mediadelete)
- [media.get](#mediaget)
- [media.getUrl](#mediageturl)
- [media.getFilePath](#mediagetfilepath)
- [media.getAll](#mediagetall)
- [media.rebuildFromFiles](#mediarebuildfromfiles)
- [media.reindexText](#mediareindextext)
- [media.getThumbnail](#mediagetthumbnail)
- [media.regenerateThumbnails](#mediaregeneratethumbnails)
- [media.regenerateMissingThumbnails](#mediaregeneratemissingthumbnails)
- [media.filter](#mediafilter)
- [media.search](#mediasearch)
- [media.getByYearMonth](#mediagetbyyearmonth)
- [media.getTags](#mediagettags)
- [media.getTagsWithCounts](#mediagettagswithcounts)
- [media.getTranslation](#mediagettranslation)
- [media.getTranslations](#mediagettranslations)
- [media.upsertTranslation](#mediaupserttranslation)
- [media.deleteTranslation](#mediadeletetranslation)

### media.import

Import media file.

**Parameters**

- sourcePath (str, required)
- metadata (dict, optional)

**Response specification**

- Return type: `MediaData`
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.import(source_path='source_path')
```

**Example response**

```python
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
```

### media.update

Update media metadata by id.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `MediaData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.update(id='id-1', data={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
```

### media.replaceFile

Replace media file by id.

**Parameters**

- id (str, required)
- newSourcePath (str, required)

**Response specification**

- Return type: `MediaData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.replace_file(id='id-1', new_source_path='new_source_path')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
```

### media.delete

Delete media by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.media.delete(id='id-1')
```

**Example response**

```python
True
```

### media.get

Fetch one media by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `MediaData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.get(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
```

### media.getUrl

Get media URL by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `string | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.media.get_url(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### media.getFilePath

Get media file path by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `string | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.media.get_file_path(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### media.getAll

Fetch all media.

**Parameters**

- None

**Response specification**

- Return type: `MediaData[]`
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.get_all()
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
]
```

### media.rebuildFromFiles

Rebuild media database from files.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.media.rebuild_from_files()
```

**Example response**

```python
None
```

### media.reindexText

Reindex media search text.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.media.reindex_text()
```

**Example response**

```python
None
```

### media.getThumbnail

Get media thumbnail URL.

**Parameters**

- id (str, required)
- size (str, optional)

**Response specification**

- Return type: `string | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.media.get_thumbnail(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### media.regenerateThumbnails

Regenerate thumbnails for media.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `Record<string, string> | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.media.regenerate_thumbnails(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### media.regenerateMissingThumbnails

Regenerate all missing thumbnails.

**Parameters**

- None

**Response specification**

- Return type: `{ processed: number; generated: number; failed: number }`

**Example call**

```python
from bds_api import bds
result = await bds.media.regenerate_missing_thumbnails()
```

**Example response**

```python
{}
```

### media.filter

Filter media by criteria.

**Parameters**

- filter (dict, required)

**Response specification**

- Return type: `MediaData[]`
- Data structures: `MediaData`

**Example call**

```python
from bds_api import bds
result = await bds.media.filter(filter={})
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'filename': 'value',
    'originalName': 'value',
    'mimeType': 'value',
    'size': 0,
    'width': 0,
    'height': 0,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'tags': 'value'
}
]
```

### media.search

Search media by free-text query.

**Parameters**

- query (str, required)

**Response specification**

- Return type: `MediaSearchResult[]`

**Example call**

```python
from bds_api import bds
result = await bds.media.search(query='search phrase')
```

**Example response**

```python
[]
```

### media.getByYearMonth

Get media counts grouped by year/month.

**Parameters**

- None

**Response specification**

- Return type: `Array<{ year: number; month: number; count: number } >`

**Example call**

```python
from bds_api import bds
result = await bds.media.get_by_year_month()
```

**Example response**

```python
[]
```

### media.getTags

Get all media tags.

**Parameters**

- None

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.media.get_tags()
```

**Example response**

```python
[]
```

### media.getTagsWithCounts

Get media tags with counts.

**Parameters**

- None

**Response specification**

- Return type: `TagCount[]`

**Example call**

```python
from bds_api import bds
result = await bds.media.get_tags_with_counts()
```

**Example response**

```python
[]
```

### media.getTranslation

Get a single translation for a media item by language.

**Parameters**

- mediaId (str, required)
- language (str, required)

**Response specification**

- Return type: `MediaTranslationData | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.media.get_translation(media_id='media-1', language='language')
```

**Example response**

```python
None  # or dict-like object when found
```

### media.getTranslations

Get all translations for a media item.

**Parameters**

- mediaId (str, required)

**Response specification**

- Return type: `MediaTranslationData[]`

**Example call**

```python
from bds_api import bds
result = await bds.media.get_translations(media_id='media-1')
```

**Example response**

```python
[]
```

### media.upsertTranslation

Create or update a media translation for a specific language.

**Parameters**

- mediaId (str, required)
- language (str, required)
- data (dict, required)

**Response specification**

- Return type: `MediaTranslationData`

**Example call**

```python
from bds_api import bds
result = await bds.media.upsert_translation(media_id='media-1', language='language', data={})
```

**Example response**

```python
{}
```

### media.deleteTranslation

Delete a media translation by language.

**Parameters**

- mediaId (str, required)
- language (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.media.delete_translation(media_id='media-1', language='language')
```

**Example response**

```python
True
```

[↑ Back to Table of contents](#table-of-contents)

## scripts

**Module APIs**

- [scripts.create](#scriptscreate)
- [scripts.update](#scriptsupdate)
- [scripts.delete](#scriptsdelete)
- [scripts.get](#scriptsget)
- [scripts.getAll](#scriptsgetall)
- [scripts.rebuildFromFiles](#scriptsrebuildfromfiles)

### scripts.create

Create script. data must include: title (str), kind ("macro"|"utility"|"transform"), content (str). Optional: slug (str), entrypoint (str, defaults to "render"), enabled (bool).

**Parameters**

- data (dict, required)

**Response specification**

- Return type: `ScriptData`
- Data structures: `ScriptData`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.create(data={})
```

**Example response**

```python
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'macro',
    'entrypoint': 'value',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### scripts.update

Update script by id. data may include any of: title, kind, content, slug, entrypoint, enabled.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `ScriptData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ScriptData`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.update(id='id-1', data={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'macro',
    'entrypoint': 'value',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### scripts.delete

Delete script by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.delete(id='id-1')
```

**Example response**

```python
True
```

### scripts.get

Fetch script by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `ScriptData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ScriptData`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.get(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'macro',
    'entrypoint': 'value',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### scripts.getAll

Fetch all scripts.

**Parameters**

- None

**Response specification**

- Return type: `ScriptData[]`
- Data structures: `ScriptData`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.get_all()
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'macro',
    'entrypoint': 'value',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
]
```

### scripts.rebuildFromFiles

Rebuild scripts from files.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.scripts.rebuild_from_files()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## templates

**Module APIs**

- [templates.create](#templatescreate)
- [templates.update](#templatesupdate)
- [templates.delete](#templatesdelete)
- [templates.get](#templatesget)
- [templates.getAll](#templatesgetall)
- [templates.getEnabledByKind](#templatesgetenabledbykind)
- [templates.validate](#templatesvalidate)
- [templates.rebuildFromFiles](#templatesrebuildfromfiles)

### templates.create

Create template. data must include: title (str), kind ("post"|"list"|"not-found"|"partial"), content (str). Optional: slug (str), enabled (bool).

**Parameters**

- data (dict, required)

**Response specification**

- Return type: `TemplateData`
- Data structures: `TemplateData`

**Example call**

```python
from bds_api import bds
result = await bds.templates.create(data={})
```

**Example response**

```python
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'post',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### templates.update

Update template by id. data may include any of: title, kind, content, slug, enabled.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `TemplateData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `TemplateData`

**Example call**

```python
from bds_api import bds
result = await bds.templates.update(id='id-1', data={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'post',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### templates.delete

Delete template by id. Without options, returns references if the template is in use. Pass options={"force": True} to clear references and delete.

**Parameters**

- id (str, required)
- options (dict, optional)

**Response specification**

- Return type: `TemplateDeleteResult`
- Data structures: `TemplateDeleteResult`

**Example call**

```python
from bds_api import bds
result = await bds.templates.delete(id='id-1')
```

**Example response**

```python
{
    'deleted': False,
    'references': 'value'
}
```

### templates.get

Fetch template by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `TemplateData | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `TemplateData`

**Example call**

```python
from bds_api import bds
result = await bds.templates.get(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'post',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### templates.getAll

Fetch all templates.

**Parameters**

- None

**Response specification**

- Return type: `TemplateData[]`
- Data structures: `TemplateData`

**Example call**

```python
from bds_api import bds
result = await bds.templates.get_all()
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'post',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
]
```

### templates.getEnabledByKind

Fetch enabled templates filtered by kind.

**Parameters**

- kind (str, required)

**Response specification**

- Return type: `TemplateData[]`
- Data structures: `TemplateData`

**Example call**

```python
from bds_api import bds
result = await bds.templates.get_enabled_by_kind(kind='kind')
```

**Example response**

```python
[
{
    'id': 'value',
    'projectId': 'value',
    'slug': 'value',
    'title': 'value',
    'kind': 'post',
    'enabled': False,
    'version': 0,
    'filePath': 'value',
    'content': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
]
```

### templates.validate

Validate Liquid template syntax.

**Parameters**

- content (str, required)

**Response specification**

- Return type: `{ valid: boolean; errors: string[] }`

**Example call**

```python
from bds_api import bds
result = await bds.templates.validate(content='content')
```

**Example response**

```python
{}
```

### templates.rebuildFromFiles

Rebuild templates from files.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.templates.rebuild_from_files()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## tasks

**Module APIs**

- [tasks.getAll](#tasksgetall)
- [tasks.getRunning](#tasksgetrunning)
- [tasks.cancel](#taskscancel)
- [tasks.clearCompleted](#tasksclearcompleted)

### tasks.getAll

Fetch all tasks.

**Parameters**

- None

**Response specification**

- Return type: `TaskProgress[]`
- Data structures: `TaskProgress`

**Example call**

```python
from bds_api import bds
result = await bds.tasks.get_all()
```

**Example response**

```python
[
{
    'taskId': 'value',
    'name': 'value',
    'status': 'pending',
    'progress': 0,
    'message': 'value',
    'startTime': 'value',
    'endTime': 'value',
    'error': 'value',
    'groupId': 'value',
    'groupName': 'value'
}
]
```

### tasks.getRunning

Fetch running tasks.

**Parameters**

- None

**Response specification**

- Return type: `TaskProgress[]`
- Data structures: `TaskProgress`

**Example call**

```python
from bds_api import bds
result = await bds.tasks.get_running()
```

**Example response**

```python
[
{
    'taskId': 'value',
    'name': 'value',
    'status': 'pending',
    'progress': 0,
    'message': 'value',
    'startTime': 'value',
    'endTime': 'value',
    'error': 'value',
    'groupId': 'value',
    'groupName': 'value'
}
]
```

### tasks.cancel

Cancel task by id.

**Parameters**

- taskId (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.tasks.cancel(task_id='task-1')
```

**Example response**

```python
True
```

### tasks.clearCompleted

Clear completed tasks.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.tasks.clear_completed()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## app

**Module APIs**

- [app.getDataPaths](#appgetdatapaths)
- [app.getSystemLanguage](#appgetsystemlanguage)
- [app.getTitleBarMetrics](#appgettitlebarmetrics)
- [app.openFolder](#appopenfolder)
- [app.showItemInFolder](#appshowiteminfolder)
- [app.selectFolder](#appselectfolder)
- [app.getDefaultProjectPath](#appgetdefaultprojectpath)
- [app.readProjectMetadata](#appreadprojectmetadata)
- [app.getBlogmarkBookmarklet](#appgetblogmarkbookmarklet)
- [app.copyToClipboard](#appcopytoclipboard)
- [app.notifyRendererReady](#appnotifyrendererready)
- [app.setPreviewPostTarget](#appsetpreviewposttarget)
- [app.triggerMenuAction](#apptriggermenuaction)

### app.getDataPaths

Get app data paths.

**Parameters**

- None

**Response specification**

- Return type: `{ database: string; posts: string; media: string }`

**Example call**

```python
from bds_api import bds
result = await bds.app.get_data_paths()
```

**Example response**

```python
{}
```

### app.getSystemLanguage

Get system language.

**Parameters**

- None

**Response specification**

- Return type: `string`

**Example call**

```python
from bds_api import bds
result = await bds.app.get_system_language()
```

**Example response**

```python
'value'
```

### app.getTitleBarMetrics

Get title bar metrics.

**Parameters**

- None

**Response specification**

- Return type: `{ macosLeftInset: number } | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.app.get_title_bar_metrics()
```

**Example response**

```python
None  # or dict-like object when found
```

### app.openFolder

Open folder in system file manager.

**Parameters**

- folderPath (str, required)

**Response specification**

- Return type: `string`

**Example call**

```python
from bds_api import bds
result = await bds.app.open_folder(folder_path='folder_path')
```

**Example response**

```python
'value'
```

### app.showItemInFolder

Reveal item in system file manager.

**Parameters**

- itemPath (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.app.show_item_in_folder(item_path='item_path')
```

**Example response**

```python
None
```

### app.selectFolder

Show folder picker dialog.

**Parameters**

- title (str, optional)

**Response specification**

- Return type: `string | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.app.select_folder()
```

**Example response**

```python
None  # or dict-like object when found
```

### app.getDefaultProjectPath

Get default project path.

**Parameters**

- projectId (str, required)

**Response specification**

- Return type: `string`

**Example call**

```python
from bds_api import bds
result = await bds.app.get_default_project_path(project_id='project-1')
```

**Example response**

```python
'value'
```

### app.readProjectMetadata

Read project metadata from path.

**Parameters**

- folderPath (str, required)

**Response specification**

- Return type: `{ name?: string; description?: string; publicUrl?: string; mainLanguage?: string } | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.app.read_project_metadata(folder_path='folder_path')
```

**Example response**

```python
None  # or dict-like object when found
```

### app.getBlogmarkBookmarklet

Get blogmark bookmarklet script.

**Parameters**

- None

**Response specification**

- Return type: `string`

**Example call**

```python
from bds_api import bds
result = await bds.app.get_blogmark_bookmarklet()
```

**Example response**

```python
'value'
```

### app.copyToClipboard

Copy text to clipboard.

**Parameters**

- text (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.app.copy_to_clipboard(text='text')
```

**Example response**

```python
True
```

### app.notifyRendererReady

Notify main process renderer is ready.

**Parameters**

- None

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.app.notify_renderer_ready()
```

**Example response**

```python
True
```

### app.setPreviewPostTarget

Set preview post target.

**Parameters**

- postId (str | None, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.app.set_preview_post_target(post_id=None)
```

**Example response**

```python
None
```

### app.triggerMenuAction

Trigger menu action.

**Parameters**

- action (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.app.trigger_menu_action(action='action')
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## meta

**Module APIs**

- [meta.getTags](#metagettags)
- [meta.getCategories](#metagetcategories)
- [meta.addTag](#metaaddtag)
- [meta.removeTag](#metaremovetag)
- [meta.addCategory](#metaaddcategory)
- [meta.removeCategory](#metaremovecategory)
- [meta.syncOnStartup](#metasynconstartup)
- [meta.getProjectMetadata](#metagetprojectmetadata)
- [meta.setProjectMetadata](#metasetprojectmetadata)
- [meta.updateProjectMetadata](#metaupdateprojectmetadata)
- [meta.getPublishingPreferences](#metagetpublishingpreferences)
- [meta.setPublishingPreferences](#metasetpublishingpreferences)
- [meta.clearPublishingPreferences](#metaclearpublishingpreferences)

### meta.getTags

Get project tags.

**Parameters**

- None

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.get_tags()
```

**Example response**

```python
[]
```

### meta.getCategories

Get project categories.

**Parameters**

- None

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.get_categories()
```

**Example response**

```python
[]
```

### meta.addTag

Add project tag.

**Parameters**

- tag (str, required)

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.add_tag(tag='tag')
```

**Example response**

```python
[]
```

### meta.removeTag

Remove project tag.

**Parameters**

- tag (str, required)

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.remove_tag(tag='tag')
```

**Example response**

```python
[]
```

### meta.addCategory

Add project category.

**Parameters**

- category (str, required)

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.add_category(category='category')
```

**Example response**

```python
[]
```

### meta.removeCategory

Remove project category.

**Parameters**

- category (str, required)

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.meta.remove_category(category='category')
```

**Example response**

```python
[]
```

### meta.syncOnStartup

Sync meta values on startup.

**Parameters**

- None

**Response specification**

- Return type: `{ tags: string[]; categories: string[]; projectMetadata: ProjectMetadata | null }`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectMetadata`

**Example call**

```python
from bds_api import bds
result = await bds.meta.sync_on_startup()
```

**Example response**

```python
[
{
    'name': 'value',
    'description': 'value',
    'dataPath': 'value',
    'publicUrl': 'value',
    'mainLanguage': 'value',
    'defaultAuthor': 'value',
    'maxPostsPerPage': 0,
    'blogmarkCategory': 'value',
    'pythonRuntimeMode': 'webworker',
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {},
    'semanticSimilarityEnabled': False
}
]
```

### meta.getProjectMetadata

Read active project metadata.

**Parameters**

- None

**Response specification**

- Return type: `ProjectMetadata | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectMetadata`

**Example call**

```python
from bds_api import bds
result = await bds.meta.get_project_metadata()
```

**Example response**

```python
None  # or
{
    'name': 'value',
    'description': 'value',
    'dataPath': 'value',
    'publicUrl': 'value',
    'mainLanguage': 'value',
    'defaultAuthor': 'value',
    'maxPostsPerPage': 0,
    'blogmarkCategory': 'value',
    'pythonRuntimeMode': 'webworker',
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {},
    'semanticSimilarityEnabled': False
}
```

### meta.setProjectMetadata

Set project metadata.

**Parameters**

- metadata (dict, required)

**Response specification**

- Return type: `ProjectMetadata | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectMetadata`

**Example call**

```python
from bds_api import bds
result = await bds.meta.set_project_metadata(metadata={})
```

**Example response**

```python
None  # or
{
    'name': 'value',
    'description': 'value',
    'dataPath': 'value',
    'publicUrl': 'value',
    'mainLanguage': 'value',
    'defaultAuthor': 'value',
    'maxPostsPerPage': 0,
    'blogmarkCategory': 'value',
    'pythonRuntimeMode': 'webworker',
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {},
    'semanticSimilarityEnabled': False
}
```

### meta.updateProjectMetadata

Update project metadata.

**Parameters**

- updates (dict, required)

**Response specification**

- Return type: `ProjectMetadata | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ProjectMetadata`

**Example call**

```python
from bds_api import bds
result = await bds.meta.update_project_metadata(updates={})
```

**Example response**

```python
None  # or
{
    'name': 'value',
    'description': 'value',
    'dataPath': 'value',
    'publicUrl': 'value',
    'mainLanguage': 'value',
    'defaultAuthor': 'value',
    'maxPostsPerPage': 0,
    'blogmarkCategory': 'value',
    'pythonRuntimeMode': 'webworker',
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {},
    'semanticSimilarityEnabled': False
}
```

### meta.getPublishingPreferences

Get publishing preferences for the active project.

**Parameters**

- None

**Response specification**

- Return type: `PublishingPreferences | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `PublishingPreferences`

**Example call**

```python
from bds_api import bds
result = await bds.meta.get_publishing_preferences()
```

**Example response**

```python
None  # or
{
    'sshHost': 'value',
    'sshUser': 'value',
    'sshRemotePath': 'value',
    'sshMode': 'scp'
}
```

### meta.setPublishingPreferences

Set publishing preferences for the active project.

**Parameters**

- prefs (dict, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.meta.set_publishing_preferences(prefs={})
```

**Example response**

```python
None
```

### meta.clearPublishingPreferences

Clear publishing preferences for the active project.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.meta.clear_publishing_preferences()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## tags

**Module APIs**

- [tags.getAll](#tagsgetall)
- [tags.getWithCounts](#tagsgetwithcounts)
- [tags.get](#tagsget)
- [tags.getByName](#tagsgetbyname)
- [tags.create](#tagscreate)
- [tags.update](#tagsupdate)
- [tags.delete](#tagsdelete)
- [tags.merge](#tagsmerge)
- [tags.rename](#tagsrename)
- [tags.getPostsWithTag](#tagsgetpostswithtag)
- [tags.syncFromPosts](#tagssyncfromposts)

### tags.getAll

Fetch all tags.

**Parameters**

- None

**Response specification**

- Return type: `TagData[]`

**Example call**

```python
from bds_api import bds
result = await bds.tags.get_all()
```

**Example response**

```python
[]
```

### tags.getWithCounts

Fetch tags with counts.

**Parameters**

- None

**Response specification**

- Return type: `TagWithCount[]`

**Example call**

```python
from bds_api import bds
result = await bds.tags.get_with_counts()
```

**Example response**

```python
[]
```

### tags.get

Fetch tag by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `TagData | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.tags.get(id='id-1')
```

**Example response**

```python
None  # or dict-like object when found
```

### tags.getByName

Fetch tag by name.

**Parameters**

- name (str, required)

**Response specification**

- Return type: `TagData | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.tags.get_by_name(name='name')
```

**Example response**

```python
None  # or dict-like object when found
```

### tags.create

Create tag.

**Parameters**

- data (dict, required)

**Response specification**

- Return type: `TagData`

**Example call**

```python
from bds_api import bds
result = await bds.tags.create(data={})
```

**Example response**

```python
{}
```

### tags.update

Update tag by id.

**Parameters**

- id (str, required)
- data (dict, required)

**Response specification**

- Return type: `TagData | null`
- Nullability: Returns `None` when no matching value exists.

**Example call**

```python
from bds_api import bds
result = await bds.tags.update(id='id-1', data={})
```

**Example response**

```python
None  # or dict-like object when found
```

### tags.delete

Delete tag by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `DeleteTagResult`

**Example call**

```python
from bds_api import bds
result = await bds.tags.delete(id='id-1')
```

**Example response**

```python
{}
```

### tags.merge

Merge tags into target tag.

**Parameters**

- sourceTagIds (list, required)
- targetTagId (str, required)

**Response specification**

- Return type: `MergeTagsResult`

**Example call**

```python
from bds_api import bds
result = await bds.tags.merge(source_tag_ids=[], target_tag_id='target_tag-1')
```

**Example response**

```python
{}
```

### tags.rename

Rename tag by id.

**Parameters**

- id (str, required)
- newName (str, required)

**Response specification**

- Return type: `RenameTagResult`

**Example call**

```python
from bds_api import bds
result = await bds.tags.rename(id='id-1', new_name='new_name')
```

**Example response**

```python
{}
```

### tags.getPostsWithTag

Get posts using a tag.

**Parameters**

- tagId (str, required)

**Response specification**

- Return type: `string[]`

**Example call**

```python
from bds_api import bds
result = await bds.tags.get_posts_with_tag(tag_id='tag-1')
```

**Example response**

```python
[]
```

### tags.syncFromPosts

Sync tag index from posts.

**Parameters**

- None

**Response specification**

- Return type: `SyncTagsResult`

**Example call**

```python
from bds_api import bds
result = await bds.tags.sync_from_posts()
```

**Example response**

```python
{}
```

[↑ Back to Table of contents](#table-of-contents)

## chat

**Module APIs**

- [chat.analyzeMediaImage](#chatanalyzemediaimage)
- [chat.detectPostLanguage](#chatdetectpostlanguage)
- [chat.analyzePost](#chatanalyzepost)
- [chat.translatePost](#chattranslatepost)
- [chat.detectMediaLanguage](#chatdetectmedialanguage)
- [chat.translateMediaMetadata](#chattranslatemediametadata)

### chat.analyzeMediaImage

Analyze an image and generate title, alt text, and caption using AI.

**Parameters**

- mediaId (str, required)
- language (str, optional)

**Response specification**

- Return type: `ImageAnalysisResult`
- Data structures: `ImageAnalysisResult`

**Example call**

```python
from bds_api import bds
result = await bds.chat.analyze_media_image(media_id='media-1')
```

**Example response**

```python
{
    'success': False,
    'title': 'value',
    'alt': 'value',
    'caption': 'value',
    'error': 'value'
}
```

### chat.detectPostLanguage

Detect the language of a post from its title and content.

**Parameters**

- title (str, required)
- content (str, required)

**Response specification**

- Return type: `{ success: boolean; language?: string; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.detect_post_language(title='title', content='content')
```

**Example response**

```python
{}
```

### chat.analyzePost

Analyze a post and generate suggested title, excerpt, and slug using AI.

**Parameters**

- postId (str, required)
- language (str, optional)

**Response specification**

- Return type: `PostAnalysisResult`
- Data structures: `PostAnalysisResult`

**Example call**

```python
from bds_api import bds
result = await bds.chat.analyze_post(post_id='post-1')
```

**Example response**

```python
{
    'success': False,
    'title': 'value',
    'excerpt': 'value',
    'slug': 'value',
    'error': 'value'
}
```

### chat.translatePost

Translate a post into a target language and save it as a translation draft.

**Parameters**

- postId (str, required)
- targetLanguage (str, required)

**Response specification**

- Return type: `PostTranslationResult`
- Data structures: `PostTranslationResult`

**Example call**

```python
from bds_api import bds
result = await bds.chat.translate_post(post_id='post-1', target_language='target_language')
```

**Example response**

```python
{
    'success': False,
    'translation': None,
    'error': 'value'
}
```

### chat.detectMediaLanguage

Detect the language of media metadata from its title, alt text, and caption.

**Parameters**

- title (str, required)
- alt (str, required)
- caption (str, required)

**Response specification**

- Return type: `{ success: boolean; language?: string; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.detect_media_language(title='title', alt='alt', caption='caption')
```

**Example response**

```python
{}
```

### chat.translateMediaMetadata

Translate media metadata (title, alt, caption) into a target language using AI.

**Parameters**

- mediaId (str, required)
- targetLanguage (str, required)

**Response specification**

- Return type: `MediaTranslationResult`

**Example call**

```python
from bds_api import bds
result = await bds.chat.translate_media_metadata(media_id='media-1', target_language='target_language')
```

**Example response**

```python
{}
```

[↑ Back to Table of contents](#table-of-contents)

## sync

**Module APIs**

- [sync.checkAvailability](#synccheckavailability)
- [sync.getRepoState](#syncgetrepostate)
- [sync.getStatus](#syncgetstatus)
- [sync.getHistory](#syncgethistory)
- [sync.getRemoteState](#syncgetremotestate)
- [sync.fetch](#syncfetch)
- [sync.pull](#syncpull)
- [sync.push](#syncpush)
- [sync.commitAll](#synccommitall)

### sync.checkAvailability

Check if git is available.

**Parameters**

- None

**Response specification**

- Return type: `GitAvailability`
- Data structures: `GitAvailability`

**Example call**

```python
from bds_api import bds
result = await bds.sync.check_availability()
```

**Example response**

```python
{
    'gitFound': False,
    'version': 'value'
}
```

### sync.getRepoState

Get repository state for active project.

**Parameters**

- None

**Response specification**

- Return type: `RepoState`
- Data structures: `RepoState`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_repo_state()
```

**Example response**

```python
{
    'isRepo': False,
    'rootPath': 'value',
    'currentBranch': 'value',
    'hasRemote': False
}
```

### sync.getStatus

Get working tree status for active project.

**Parameters**

- None

**Response specification**

- Return type: `GitStatusDto`
- Data structures: `GitStatusDto`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_status()
```

**Example response**

```python
{
    'files': 'value',
    'counts': 0
}
```

### sync.getHistory

Get commit history for active project.

**Parameters**

- limit (int | float, optional)

**Response specification**

- Return type: `GitHistoryEntry[]`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_history()
```

**Example response**

```python
[]
```

### sync.getRemoteState

Get remote tracking state for active project.

**Parameters**

- None

**Response specification**

- Return type: `GitRemoteStateDto`
- Data structures: `GitRemoteStateDto`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_remote_state()
```

**Example response**

```python
{
    'localBranch': 'value',
    'upstreamBranch': 'value',
    'hasUpstream': False,
    'ahead': 0,
    'behind': 0
}
```

### sync.fetch

Fetch from remote for active project.

**Parameters**

- None

**Response specification**

- Return type: `GitActionResult`
- Data structures: `GitActionResult`

**Example call**

```python
from bds_api import bds
result = await bds.sync.fetch()
```

**Example response**

```python
{
    'success': False,
    'code': 'value',
    'error': 'value',
    'guidance': 'value'
}
```

### sync.pull

Pull from remote for active project.

**Parameters**

- None

**Response specification**

- Return type: `GitActionResult`
- Data structures: `GitActionResult`

**Example call**

```python
from bds_api import bds
result = await bds.sync.pull()
```

**Example response**

```python
{
    'success': False,
    'code': 'value',
    'error': 'value',
    'guidance': 'value'
}
```

### sync.push

Push to remote for active project.

**Parameters**

- None

**Response specification**

- Return type: `GitActionResult`
- Data structures: `GitActionResult`

**Example call**

```python
from bds_api import bds
result = await bds.sync.push()
```

**Example response**

```python
{
    'success': False,
    'code': 'value',
    'error': 'value',
    'guidance': 'value'
}
```

### sync.commitAll

Stage all changes and commit for active project.

**Parameters**

- message (str, required)

**Response specification**

- Return type: `GitActionResult`
- Data structures: `GitActionResult`

**Example call**

```python
from bds_api import bds
result = await bds.sync.commit_all(message='message')
```

**Example response**

```python
{
    'success': False,
    'code': 'value',
    'error': 'value',
    'guidance': 'value'
}
```

[↑ Back to Table of contents](#table-of-contents)

## publish

**Module APIs**

- [publish.uploadSite](#publishuploadsite)

### publish.uploadSite

Upload rendered site to remote server via SSH.

**Parameters**

- credentials (dict, required)

**Response specification**

- Return type: `PublishSiteResult`
- Data structures: `PublishSiteResult`

**Example call**

```python
from bds_api import bds
result = await bds.publish.upload_site(credentials={})
```

**Example response**

```python
{
    'htmlFilesUploaded': 0,
    'thumbnailFilesUploaded': 0,
    'mediaFilesUploaded': 0,
    'filesSkipped': 0
}
```

[↑ Back to Table of contents](#table-of-contents)

## embeddings

**Module APIs**

- [embeddings.findSimilar](#embeddingsfindsimilar)
- [embeddings.computeSimilarities](#embeddingscomputesimilarities)
- [embeddings.getProgress](#embeddingsgetprogress)
- [embeddings.suggestTags](#embeddingssuggesttags)
- [embeddings.findDuplicates](#embeddingsfindduplicates)
- [embeddings.dismissPair](#embeddingsdismisspair)
- [embeddings.indexUnindexedPosts](#embeddingsindexunindexedposts)

### embeddings.findSimilar

Find posts semantically similar to the given post. Requires semantic similarity to be enabled in project settings.

**Parameters**

- postId (str, required)
- k (int | float, optional)

**Response specification**

- Return type: `SimilarPost[]`
- Data structures: `SimilarPost`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.find_similar(post_id='post-1')
```

**Example response**

```python
[
{
    'postId': 'value',
    'similarity': 0
}
]
```

### embeddings.computeSimilarities

Compute cosine similarity between a source post and a list of target posts. Returns a mapping of target post IDs to similarity scores (0.0-1.0). Posts without embeddings are omitted.

**Parameters**

- sourcePostId (str, required)
- targetPostIds (list, required)

**Response specification**

- Return type: `Record<string, number>`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.compute_similarities(source_post_id='source_post-1', target_post_ids=[])
```

**Example response**

```python
{}
```

### embeddings.getProgress

Get the embedding indexing progress for the active project.

**Parameters**

- None

**Response specification**

- Return type: `{ indexed: number; total: number }`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.get_progress()
```

**Example response**

```python
{}
```

### embeddings.suggestTags

Suggest tags for a post based on tags used by semantically similar posts.

**Parameters**

- postId (str, required)
- excludeTags (list, required)

**Response specification**

- Return type: `TagSuggestion[]`
- Data structures: `TagSuggestion`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.suggest_tags(post_id='post-1', exclude_tags=[])
```

**Example response**

```python
[
{
    'name': 'value',
    'score': 0
}
]
```

### embeddings.findDuplicates

Find post pairs with high content similarity (potential duplicates). Threshold is a similarity value from 0.0 to 1.0 (default 0.85).

**Parameters**

- threshold (int | float, optional)

**Response specification**

- Return type: `DuplicatePair[]`
- Data structures: `DuplicatePair`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.find_duplicates()
```

**Example response**

```python
[
{
    'postA': 'value',
    'postB': 'value',
    'similarity': 0
}
]
```

### embeddings.dismissPair

Dismiss a duplicate pair so it no longer appears in results.

**Parameters**

- postIdA (str, required)
- postIdB (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.dismiss_pair(post_id_a='post_id_a-1', post_id_b='post_id_b-1')
```

**Example response**

```python
None
```

### embeddings.indexUnindexedPosts

Trigger background indexing of all posts not yet embedded.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.embeddings.index_unindexed_posts()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## Data Structures

Shared structures referenced by response types are defined once here.

### PublishingPreferences

Publishing connection preferences stored in meta/publishing.json (shareable, no secrets).

**Fields**

- sshHost (`string`, required): SSH hostname for publishing.
- sshUser (`string`, required): SSH username for publishing.
- sshRemotePath (`string`, required): Remote path on the server.
- sshMode (`'scp' | 'rsync'`, required): Upload mode (scp or rsync).

[↑ Back to Table of contents](#table-of-contents)

### ProjectData

Project metadata stored in the app database.

**Fields**

- id (`string`, required): Unique project identifier.
- name (`string`, required): Human-readable project name.
- slug (`string`, required): URL-friendly project slug.
- description (`string`, optional): Optional project description.
- dataPath (`string`, optional): Filesystem path for project data.
- isActive (`boolean`, required): Whether this project is currently active.
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).

[↑ Back to Table of contents](#table-of-contents)

### PostData

Canonical post object used across editor and generation flows.

**Fields**

- id (`string`, required): Unique post identifier.
- projectId (`string`, required): Owning project id.
- title (`string`, required): Post title.
- slug (`string`, required): URL slug used for generated routes.
- excerpt (`string`, optional): Optional short summary.
- content (`string`, required): Markdown body content.
- status (`'draft' | 'published' | 'archived'`, required): Publication lifecycle state.
- author (`string`, optional): Optional author name.
- language (`string`, optional): Optional per-post language code (e.g. en, de, fr, it, es).
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).
- publishedAt (`string`, optional): Publication timestamp for published posts.
- tags (`string[]`, required): List of tag names.
- categories (`string[]`, required): List of category names.
- availableLanguages (`string[]`, required): Canonical language plus all available translation language codes for this post.

[↑ Back to Table of contents](#table-of-contents)

### MediaData

Canonical media object representing imported files and metadata.

**Fields**

- id (`string`, required): Unique media identifier.
- projectId (`string`, required): Owning project id.
- filename (`string`, required): Stored filename in project media folder.
- originalName (`string`, required): Original imported filename.
- mimeType (`string`, required): Detected MIME type.
- size (`number`, required): File size in bytes.
- width (`number`, optional): Image width in pixels when available.
- height (`number`, optional): Image height in pixels when available.
- title (`string`, optional): Optional display title.
- alt (`string`, optional): Optional alternative text.
- caption (`string`, optional): Optional caption text.
- author (`string`, optional): Optional author credit.
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).
- tags (`string[]`, required): List of media tags.

[↑ Back to Table of contents](#table-of-contents)

### ScriptData

Script definition for Python macros, utilities, and transforms.

**Fields**

- id (`string`, required): Unique script identifier.
- projectId (`string`, required): Owning project id.
- slug (`string`, required): Stable script slug.
- title (`string`, required): Human-readable script title.
- kind (`'macro' | 'utility' | 'transform'`, required): Script category.
- entrypoint (`string`, required): Python entrypoint function name.
- enabled (`boolean`, required): Whether script is enabled.
- version (`number`, required): Incrementing script version.
- filePath (`string`, required): Filesystem path to script file.
- content (`string`, required): Script source code.
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).

[↑ Back to Table of contents](#table-of-contents)

### TemplateData

Liquid template definition for posts, lists, not-found pages, and partials.

**Fields**

- id (`string`, required): Unique template identifier.
- projectId (`string`, required): Owning project id.
- slug (`string`, required): Stable template slug.
- title (`string`, required): Human-readable template title.
- kind (`'post' | 'list' | 'not-found' | 'partial'`, required): Template category.
- enabled (`boolean`, required): Whether template is enabled.
- version (`number`, required): Incrementing template version.
- filePath (`string`, required): Filesystem path to template file.
- content (`string`, required): Liquid template source code.
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).

[↑ Back to Table of contents](#table-of-contents)

### TemplateDeleteResult

Result of a template delete operation. If the template is referenced by posts or tags, deleted is false and references lists the referencing IDs.

**Fields**

- deleted (`boolean`, required): Whether the template was deleted.
- references (`{ postIds: string[]; tagIds: string[] }`, optional): Post and tag IDs referencing this template (present when deleted is false and references exist).

[↑ Back to Table of contents](#table-of-contents)

### TaskProgress

Task queue status object for long-running operations.

**Fields**

- taskId (`string`, required): Unique task identifier.
- name (`string`, required): Task display name.
- status (`'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`, required): Current task status.
- progress (`number`, required): Progress percentage from 0-100.
- message (`string`, required): Current progress message.
- startTime (`string`, required): Task start time (ISO string).
- endTime (`string`, optional): Task completion time (ISO string).
- error (`string`, optional): Error message when failed.
- groupId (`string`, optional): Optional grouping id.
- groupName (`string`, optional): Optional grouping label.

[↑ Back to Table of contents](#table-of-contents)

### ProjectMetadata

Extended project metadata from project settings.

**Fields**

- name (`string`, required): Project display name.
- description (`string`, optional): Optional project description.
- dataPath (`string`, optional): Optional custom data path.
- publicUrl (`string`, optional): Optional public site URL.
- mainLanguage (`string`, optional): Main render language code.
- defaultAuthor (`string`, optional): Default author for new posts.
- maxPostsPerPage (`number`, optional): Pagination size for generated lists.
- blogmarkCategory (`string`, optional): Default category for blogmark imports.
- pythonRuntimeMode (`'webworker' | 'main-thread'`, optional): Python runtime execution mode.
- picoTheme (`string`, optional): Preferred Pico theme token.
- categoryMetadata (`object`, optional): Category metadata keyed by category slug.
- categorySettings (`object`, optional): Category render settings keyed by category slug.
- semanticSimilarityEnabled (`boolean`, optional): Enable local ONNX embedding-based semantic similarity features.

[↑ Back to Table of contents](#table-of-contents)

### GitAvailability

Git installation availability check result.

**Fields**

- gitFound (`boolean`, required): Whether git executable was found.
- version (`string`, optional): Git version string when available.

[↑ Back to Table of contents](#table-of-contents)

### RepoState

Repository state for the active project.

**Fields**

- isRepo (`boolean`, required): Whether the project directory is a git repository.
- rootPath (`string`, optional): Repository root path.
- currentBranch (`string`, optional): Current branch name.
- hasRemote (`boolean`, required): Whether a remote is configured.

[↑ Back to Table of contents](#table-of-contents)

### GitStatusDto

Working tree status with file list and counts.

**Fields**

- files (`Array<{ path: string; status: string; previousPath?: string }>`, required): List of changed files with status.
- counts (`{ untracked: number; modified: number; deleted: number; renamed: number; staged: number }`, required): Counts by change type.

[↑ Back to Table of contents](#table-of-contents)

### GitRemoteStateDto

Remote tracking state for the active project branch.

**Fields**

- localBranch (`string | null`, required): Local branch name.
- upstreamBranch (`string | null`, required): Upstream tracking branch name.
- hasUpstream (`boolean`, required): Whether an upstream is configured.
- ahead (`number`, required): Commits ahead of upstream.
- behind (`number`, required): Commits behind upstream.

[↑ Back to Table of contents](#table-of-contents)

### GitActionResult

Result from a git operation (fetch, pull, push, commit).

**Fields**

- success (`boolean`, required): Whether the operation succeeded.
- code (`string`, optional): Error code when failed ('auth-required', 'conflict', 'network', 'action-failed').
- error (`string`, optional): Error message when failed.
- guidance (`string[]`, optional): Guidance messages for resolving failures.

[↑ Back to Table of contents](#table-of-contents)

### PublishSiteResult

Aggregate result from uploading the rendered site.

**Fields**

- htmlFilesUploaded (`number`, required): Number of HTML files uploaded.
- thumbnailFilesUploaded (`number`, required): Number of thumbnail files uploaded.
- mediaFilesUploaded (`number`, required): Number of media files uploaded.
- filesSkipped (`number`, required): Total files skipped (already up-to-date).

[↑ Back to Table of contents](#table-of-contents)

### ImageAnalysisResult

Result from AI image analysis containing generated title, alt text, and caption.

**Fields**

- success (`boolean`, required): Whether the analysis succeeded.
- title (`string`, optional): Generated image title (3-8 words).
- alt (`string`, optional): Generated alt text (5-12 words).
- caption (`string`, optional): Generated blog caption (5-20 words).
- error (`string`, optional): Error message when analysis failed.

[↑ Back to Table of contents](#table-of-contents)

### PostAnalysisResult

Result from AI post analysis containing suggested title, excerpt, and slug.

**Fields**

- success (`boolean`, required): Whether the analysis succeeded.
- title (`string`, optional): Suggested post title.
- excerpt (`string`, optional): Suggested plain-text excerpt summarizing the post.
- slug (`string`, optional): Suggested URL-friendly slug.
- error (`string`, optional): Error message when analysis failed.

[↑ Back to Table of contents](#table-of-contents)

### PostTranslationData

Stored translation draft or published translation for a post.

**Fields**

- id (`string`, required): Translation identifier.
- projectId (`string`, required): Owning project identifier.
- translationFor (`string`, required): Source post identifier this translation belongs to.
- language (`string`, required): Target language code for the translation.
- title (`string`, required): Translated title.
- excerpt (`string`, optional): Translated excerpt.
- content (`string`, required): Translated Markdown content.
- status (`'draft' | 'published' | 'archived'`, required): Translation lifecycle state.
- createdAt (`string`, required): Creation timestamp.
- updatedAt (`string`, required): Last update timestamp.
- publishedAt (`string`, optional): Publish timestamp when the translation is published.
- filePath (`string`, required): Translation file path on disk.

[↑ Back to Table of contents](#table-of-contents)

### PostTranslationResult

Result from AI post translation containing the saved translation draft.

**Fields**

- success (`boolean`, required): Whether the translation succeeded.
- translation (`PostTranslationData`, optional): Saved translation draft when successful.
- error (`string`, optional): Error message when translation failed.

[↑ Back to Table of contents](#table-of-contents)

### SimilarPost

A post with its semantic similarity score relative to a reference post.

**Fields**

- postId (`string`, required): Post identifier.
- similarity (`number`, required): Cosine similarity score from 0.0 to 1.0.

[↑ Back to Table of contents](#table-of-contents)

### TagSuggestion

A tag suggested based on semantic similarity to similar posts.

**Fields**

- name (`string`, required): Tag name.
- score (`number`, required): Aggregated suggestion score.

[↑ Back to Table of contents](#table-of-contents)

### DuplicatePair

A pair of posts with high content similarity that may be duplicates.

**Fields**

- postA (`{ id: string; title: string; slug: string; publishedAt?: string }`, required): First post in the pair.
- postB (`{ id: string; title: string; slug: string; publishedAt?: string }`, required): Second post in the pair.
- similarity (`number`, required): Cosine similarity score from 0.0 to 1.0.

[↑ Back to Table of contents](#table-of-contents)

---

Generated from contract at 2026-03-07T00:00:00.000Z.
