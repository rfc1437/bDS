# API Documentation

Contract version: 1.3.0

This reference documents all Python runtime API calls available through `bds_api` in embedded Pyodide.

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
- [tasks](#tasks)
- [app](#app)
- [meta](#meta)
- [tags](#tags)
- [chat](#chat)
- [sync](#sync)
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
- [posts.getPreviewUrl](#postsgetpreviewurl)
- [posts.getAll](#postsgetall)
- [posts.getByStatus](#postsgetbystatus)
- [posts.publish](#postspublish)
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
}
```

### posts.getPreviewUrl

Get preview URL for post.

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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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

Filter posts by criteria.

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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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
    'status': None,
    'author': 'value',
    'createdAt': 'value',
    'updatedAt': 'value',
    'publishedAt': 'value',
    'tags': 'value',
    'categories': 'value'
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

Create script.

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
    'kind': None,
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

Update script by id.

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
    'kind': None,
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
    'kind': None,
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
    'kind': None,
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
    'status': None,
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
    'status': None,
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
    'pythonRuntimeMode': None,
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {}
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
    'pythonRuntimeMode': None,
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {}
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
    'pythonRuntimeMode': None,
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {}
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
    'pythonRuntimeMode': None,
    'picoTheme': 'value',
    'categoryMetadata': {},
    'categorySettings': {}
}
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

- [chat.checkReady](#chatcheckready)
- [chat.validateApiKey](#chatvalidateapikey)
- [chat.setApiKey](#chatsetapikey)
- [chat.getApiKey](#chatgetapikey)
- [chat.getAvailableModels](#chatgetavailablemodels)
- [chat.setDefaultModel](#chatsetdefaultmodel)
- [chat.getSystemPrompt](#chatgetsystemprompt)
- [chat.setSystemPrompt](#chatsetsystemprompt)
- [chat.getConversations](#chatgetconversations)
- [chat.createConversation](#chatcreateconversation)
- [chat.getConversation](#chatgetconversation)
- [chat.updateConversation](#chatupdateconversation)
- [chat.deleteConversation](#chatdeleteconversation)
- [chat.sendMessage](#chatsendmessage)
- [chat.abortMessage](#chatabortmessage)
- [chat.getHistory](#chatgethistory)
- [chat.clearMessages](#chatclearmessages)
- [chat.setConversationModel](#chatsetconversationmodel)
- [chat.analyzeTaxonomy](#chatanalyzetaxonomy)
- [chat.analyzeMediaImage](#chatanalyzemediaimage)

### chat.checkReady

Check chat backend readiness.

**Parameters**

- None

**Response specification**

- Return type: `ChatReadyStatus`
- Data structures: `ChatReadyStatus`

**Example call**

```python
from bds_api import bds
result = await bds.chat.check_ready()
```

**Example response**

```python
{
    'ready': False,
    'error': 'value',
    'backend': 'value'
}
```

### chat.validateApiKey

Validate chat API key and list available models.

**Parameters**

- apiKey (str, required)

**Response specification**

- Return type: `{ isValid: boolean; models: ChatModel[] }`
- Data structures: `ChatModel`

**Example call**

```python
from bds_api import bds
result = await bds.chat.validate_api_key(api_key='api_key')
```

**Example response**

```python
[
{
    'id': 'value',
    'name': 'value',
    'provider': 'value'
}
]
```

### chat.setApiKey

Store chat API key.

**Parameters**

- apiKey (str, required)

**Response specification**

- Return type: `{ success: boolean; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.set_api_key(api_key='api_key')
```

**Example response**

```python
{}
```

### chat.getApiKey

Get stored chat API key status.

**Parameters**

- None

**Response specification**

- Return type: `ChatApiKeyStatus`
- Data structures: `ChatApiKeyStatus`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_api_key()
```

**Example response**

```python
{
    'hasKey': False,
    'maskedKey': 'value'
}
```

### chat.getAvailableModels

Get available chat models and selected default.

**Parameters**

- None

**Response specification**

- Return type: `{ success: boolean; models?: ChatModel[]; selectedModel?: string; error?: string }`
- Data structures: `ChatModel`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_available_models()
```

**Example response**

```python
[
{
    'id': 'value',
    'name': 'value',
    'provider': 'value'
}
]
```

### chat.setDefaultModel

Set default chat model.

**Parameters**

- modelId (str, required)

**Response specification**

- Return type: `{ success: boolean; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.set_default_model(model_id='model-1')
```

**Example response**

```python
{}
```

### chat.getSystemPrompt

Get configured system prompt.

**Parameters**

- None

**Response specification**

- Return type: `{ success: boolean; prompt?: string; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_system_prompt()
```

**Example response**

```python
{}
```

### chat.setSystemPrompt

Set system prompt.

**Parameters**

- prompt (str, required)

**Response specification**

- Return type: `{ success: boolean; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.set_system_prompt(prompt='prompt')
```

**Example response**

```python
{}
```

### chat.getConversations

Fetch all chat conversations.

**Parameters**

- None

**Response specification**

- Return type: `ChatConversation[]`
- Data structures: `ChatConversation`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_conversations()
```

**Example response**

```python
[
{
    'id': 'value',
    'title': 'value',
    'model': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
]
```

### chat.createConversation

Create a chat conversation.

**Parameters**

- title (str, optional)
- model (str, optional)

**Response specification**

- Return type: `ChatConversation`
- Data structures: `ChatConversation`

**Example call**

```python
from bds_api import bds
result = await bds.chat.create_conversation()
```

**Example response**

```python
{
    'id': 'value',
    'title': 'value',
    'model': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### chat.getConversation

Fetch one chat conversation by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `ChatConversation | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ChatConversation`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_conversation(id='id-1')
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'title': 'value',
    'model': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### chat.updateConversation

Update chat conversation metadata.

**Parameters**

- id (str, required)
- updates (dict, required)

**Response specification**

- Return type: `ChatConversation | null`
- Nullability: Returns `None` when no matching value exists.
- Data structures: `ChatConversation`

**Example call**

```python
from bds_api import bds
result = await bds.chat.update_conversation(id='id-1', updates={})
```

**Example response**

```python
None  # or
{
    'id': 'value',
    'title': 'value',
    'model': 'value',
    'createdAt': 'value',
    'updatedAt': 'value'
}
```

### chat.deleteConversation

Delete chat conversation by id.

**Parameters**

- id (str, required)

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.chat.delete_conversation(id='id-1')
```

**Example response**

```python
True
```

### chat.sendMessage

Send message to chat conversation.

**Parameters**

- conversationId (str, required)
- message (str, required)

**Response specification**

- Return type: `{ success: boolean; message?: string; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.send_message(conversation_id='conversation-1', message='message')
```

**Example response**

```python
{}
```

### chat.abortMessage

Abort active streaming chat response.

**Parameters**

- conversationId (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.chat.abort_message(conversation_id='conversation-1')
```

**Example response**

```python
None
```

### chat.getHistory

Get message history for conversation.

**Parameters**

- conversationId (str, required)

**Response specification**

- Return type: `ChatMessage[]`
- Data structures: `ChatMessage`

**Example call**

```python
from bds_api import bds
result = await bds.chat.get_history(conversation_id='conversation-1')
```

**Example response**

```python
[
{
    'id': 'value',
    'conversationId': 'value',
    'role': None,
    'content': 'value',
    'toolCallId': 'value',
    'toolCalls': 'value',
    'createdAt': 'value'
}
]
```

### chat.clearMessages

Clear messages for conversation.

**Parameters**

- conversationId (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.chat.clear_messages(conversation_id='conversation-1')
```

**Example response**

```python
None
```

### chat.setConversationModel

Set model for a conversation.

**Parameters**

- conversationId (str, required)
- modelId (str, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.chat.set_conversation_model(conversation_id='conversation-1', model_id='model-1')
```

**Example response**

```python
None
```

### chat.analyzeTaxonomy

Analyze categories and tags using AI.

**Parameters**

- categories (list, required)
- tags (list, required)
- modelId (str, required)

**Response specification**

- Return type: `{ success: boolean; categoryMappings?: Record<string, string>; tagMappings?: Record<string, string>; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.analyze_taxonomy(categories=[], tags=[], model_id='model-1')
```

**Example response**

```python
{}
```

### chat.analyzeMediaImage

Analyze media image and propose metadata.

**Parameters**

- mediaId (str, required)
- language (str, optional)

**Response specification**

- Return type: `{ success: boolean; title?: string; alt?: string; caption?: string; error?: string }`

**Example call**

```python
from bds_api import bds
result = await bds.chat.analyze_media_image(media_id='media-1')
```

**Example response**

```python
{}
```

[↑ Back to Table of contents](#table-of-contents)

## sync

**Module APIs**

- [sync.configure](#syncconfigure)
- [sync.start](#syncstart)
- [sync.getStatus](#syncgetstatus)
- [sync.isConfigured](#syncisconfigured)
- [sync.getPendingCount](#syncgetpendingcount)
- [sync.getLog](#syncgetlog)
- [sync.stopAutoSync](#syncstopautosync)

### sync.configure

Configure sync.

**Parameters**

- config (dict, required)

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.sync.configure(config={})
```

**Example response**

```python
None
```

### sync.start

Start sync operation.

**Parameters**

- direction (str, optional)

**Response specification**

- Return type: `SyncResult`

**Example call**

```python
from bds_api import bds
result = await bds.sync.start()
```

**Example response**

```python
{}
```

### sync.getStatus

Get sync status.

**Parameters**

- None

**Response specification**

- Return type: `'idle' | 'syncing' | 'error'`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_status()
```

**Example response**

```python
{}
```

### sync.isConfigured

Check if sync is configured.

**Parameters**

- None

**Response specification**

- Return type: `boolean`

**Example call**

```python
from bds_api import bds
result = await bds.sync.is_configured()
```

**Example response**

```python
True
```

### sync.getPendingCount

Get pending sync item count.

**Parameters**

- None

**Response specification**

- Return type: `{ posts: number; media: number }`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_pending_count()
```

**Example response**

```python
{}
```

### sync.getLog

Get sync log.

**Parameters**

- limit (int | float, optional)

**Response specification**

- Return type: `unknown[]`

**Example call**

```python
from bds_api import bds
result = await bds.sync.get_log()
```

**Example response**

```python
[]
```

### sync.stopAutoSync

Stop automatic sync.

**Parameters**

- None

**Response specification**

- Return type: `void`

**Example call**

```python
from bds_api import bds
result = await bds.sync.stop_auto_sync()
```

**Example response**

```python
None
```

[↑ Back to Table of contents](#table-of-contents)

## Data Structures

Shared structures referenced by response types are defined once here.

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
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).
- publishedAt (`string`, optional): Publication timestamp for published posts.
- tags (`string[]`, required): List of tag names.
- categories (`string[]`, required): List of category names.

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

[↑ Back to Table of contents](#table-of-contents)

### ChatConversation

Chat conversation container.

**Fields**

- id (`string`, required): Unique conversation identifier.
- title (`string`, required): Conversation title.
- model (`string`, optional): Optional model id used by this conversation.
- createdAt (`string`, required): Creation timestamp (ISO string).
- updatedAt (`string`, required): Last update timestamp (ISO string).

[↑ Back to Table of contents](#table-of-contents)

### ChatMessage

Single message entry in a conversation history.

**Fields**

- id (`string`, required): Unique message identifier.
- conversationId (`string`, required): Owning conversation id.
- role (`'user' | 'assistant' | 'system' | 'tool'`, required): Message author role.
- content (`string`, required): Message text content.
- toolCallId (`string`, optional): Tool call id when associated with tool output.
- toolCalls (`string`, optional): Serialized tool call payload when present.
- createdAt (`string`, required): Creation timestamp (ISO string).

[↑ Back to Table of contents](#table-of-contents)

### ChatModel

Available chat model descriptor.

**Fields**

- id (`string`, required): Model identifier.
- name (`string`, required): Human-readable model name.
- provider (`string`, optional): Model provider name.

[↑ Back to Table of contents](#table-of-contents)

### ChatReadyStatus

Chat backend readiness status.

**Fields**

- ready (`boolean`, required): Whether chat backend is ready.
- error (`string`, optional): Error description when not ready.
- backend (`string`, optional): Selected backend identifier.

[↑ Back to Table of contents](#table-of-contents)

### ChatApiKeyStatus

Stored API key state for chat provider.

**Fields**

- hasKey (`boolean`, required): Whether a key is configured.
- maskedKey (`string`, required): Masked key representation for UI display.

[↑ Back to Table of contents](#table-of-contents)

---

Generated from contract at 2026-02-24T00:00:00.000Z.
