# blogging Desktop Server

Back in the day I had a tool named Python Desktop Server that was a
self-contained blogging engine with an integrated webserver and database that
allowed management of blog posts in an easy local way and a sync to a cloud
system for syncing data and also rendering the full blog.

This document remains the long-term vision, but parts of it are already
implemented in bDS (Electron + TypeScript + SQLite/Drizzle, multi-project
support, markdown/media workflows, preview server, importer pipeline,
task/progress UI, and git tooling).

## Main Vision

The app is an Electron app in this folder that uses TypeScript for logic code
and SQLite with a proper database framework for local storage of data.
The UI should be aligned with the UI patterns used by vscode. The name of the
application is "blogging Desktop Server" and the shortname is bDS. Start with
default layout for edit and view menus and things like that. I don't want the
app to use raw SQL, I want some proper layer between those and proper wiring
where all actual functional code is kept in engine classes and the UI really
just does presentation and reacts to state changes properly, so that
long-running processes can properly integrate as async tasks.

The main area of the window must be a tabbed view, where multiple tabs can be
open at the same time and are retained over program runs. The tabs can be
different tabs like media file tabs, post tabs for multiple posts and setting
tabs or whatever will come later.

Blog post metadata should be managed in the SQLite database in the user local
folder, so it persists application runs properly. For blog posts, create a
subfolder /posts/ there where each post is stored as a markdown file with a
properties segment at the top of the file with YAML-like property definitions,
so all metadata can always be reconstructed from posts. Do the same with images,
keeping them in /media/ under the user local path, in that case storing the
image files and for each image file a properties sidecar file that uses the same
header structure as for posts.

The application must be offline-first, everything must work in airplane mode
(except exporting / AI of course). It must be fully self-contained during
editing and previewing and managing content. Every internal structure must have
reflections in the filesystem, so available tags, available categories, all
those things must be automatically reflected to the filesystem in a per-project
way. Use a meta/ folder under the project folder for those files.

The application supports multiple projects (ie web sites), so
there must be a way to create new projects and select current project. The UI is
only showing all data of the current selected project and all tools are only
working against the selected project. Projects are currently separated by
project-scoped folders and metadata.

I want proper full-text search for posts based on the integrated SQLite
database using FTS5, so that I can quickly find posts. Keep proper text
search index update into the core model right away, so that regardless how posts
come into the system, they are always properly indexed.

Additionally bring in a good markdown library, because all posts will be
formatted in markdown for easy portability to future systems. Media files can be
attached to posts and can be referenced with standard markdown notation with a
post-relative path, so it is easy for the user to include images. The post
editor should support both a WYSIWYG editor and raw markdown editor, so the user
does not have to know markdown, but everything is handled by the editor, but for
complex parts, markdown is available for power users.

Integrate toasts as notification mechanism that will be used whenever anything
has to communicate success/failure to the user.

Integrated images in posts should be shown with a lightbox effect as galleries
when there are multiple photos, or just as single images with lightbox when
there is only one. The WYSIWYG editor should support this at least on a basic
level.

## Posting life-cycle

New posts start in draft state. Drafts are automatically saved in the
background, but the draft content is not directly part of the publishing
pipeline. A user can discard a draft, which either deletes a new post or reverts
a post that is edited to the last published state.

A user can publish a post, that moves the content from the draft state to the
published state. Also a user can start editing in a published post, that moves
it to draft state with a copy of the original post as the starting point.

So essentially posts have two content fields, one for draft and one for
published. Editing only happens on the draft state. Undo/Redo is also only
available on the draft state editing session in the text field with standard
mechanisms.

Published posts have a delete button that allows deleting a post that exists.
This will internally switch the post to deleted, and filter it out, but will not
remove it fully from the database, because the publishing pipeline later might
need the fact of the deletion as information source to do its thing (update
relevant files).

So a post starts in "draft" and can go to "published" and from there to
"archived". From "draft" it can only go back to "published" (via discard) or
vanish fully from the database (because drafts for new posts are not relevant
for the pipeline, as they never were published before).

Posts in draft are automatically saved during edit when idle and a dot in the
tab title gives information about its state as unsaved. The user can force the
save with the standard hotkey for that purpose or just wait. Switching to
another post will also save a draft automatically.

Important for the handling of posts is that draft content is always kept in the
database and only when the user uses the publish button the content is moved to
the filesystem and the content in the database is set to empty again. This is
meant to keep draft content in the database, as it is volatile, and only
published content in filesystem, where it is then later used by the publishing
pipeline.

So only posts in state draft have content in the database, but whenever
something goes to state published, the draft content is set to empty. draft
something goes to state published, the draft content is set to empty. Draft
content contains text content as well as metadata content that was changed. So
even if the user changes tags or the category or the title or whatnot, the
actual data is first only kept in the database and only on publish moved to the
file.

Database rebuild at startup is not overwriting draft content, it is only
recreating missing posts.

Published content is only ever updated when the publish action is done by the
user.

Deletion warns if some media file or post is dependent on the one you are about
to delete, because that will break the relation.

## UI and UX specifics

The UI and UX should be aligned with modern applications like vscode. I want
an icon bar and left sidebar and the big main area with tabbed views. Open views
will be automatically opened again on next start, so the user does not have to
reselect everything.

All sidebar areas and panels can be resized easily and resizings are persisted
so they are the same on next application start. UI configuration is persisted on
the project level, so when I switch projects, I get the same layout and opened
tabs as the last time I worked on that project.

Sidebar will be shown/hidden by repeated clicking on same icon, just as with
vscode. Also the title bar has the typical "show/hide left sidebar" icon as
vscode has it.

The main area is a tabbed layout with proper tab support that stay open even on
sidebar switching and that grow and shrink accordingly when the sidebar is
activated or deactivated.

There are no lengthy synchronous actions in the UI thread, everything is
offloaded to the main thread and if it is complex, to async tasks, with proper
integration with the UI and notification about state of those asynchronous tasks
via toasts. There is a central notification framework used by everything, so we
are sure that the user is informed about ongoing activities at all times.

There is a bottom status bar in the app that for example shows how many async
tasks are running at any time, so if we run maybe two importers in parallel, the
user will be able to see that there are 2 tasks running and will be able to click
on that to see a small popup that lists all active async tasks.

All preferences are always local to the selected project and project settings
are easily reachable via a gear icon in the bottom of the iconbar. Also login
are easily reachable via a gear icon in the bottom of the icon bar. Also login
credentials can be managed via a user icon in the bottom of the icon bar
directly above the gear icon. This is similar to what vscode does, separating
logins and settings.

Tags are something that should be mainly focused on reusing but need easy ways to
add new tags. This should not be a simple text field, but more a feature like
tags in GitLab, where you can easily select multiple available tags, but also
can quickly create new tags. Tags should have a color and there should be a way
to manage tags in the preferences, too, so that users can create tags upfront for
posts.

Categories are a simple selection via dropdown and a preferences panel that
allows category management. Categories are mainly used to denote different
styles of posts and posts are only of one style.

## Organizing

Blog posts should be organized in the app in the main post view where the
sidebar lists posts and the main tab area can have multiple posts (new or
selected from the sidebar) open, just like vscode manages text files. The
sidebar for posts must also include a calendar view at the top that allows to go
to specific dates or date ranges (by selecting a whole month of a year for
example) and then accordingly filter down the post list in the sidebar.

And there must be a way to use markdown links of a specific short-form to
reference other posts, so that I can link to other places, if needed, and those
references should also be part of the information about posts. So each post
should give a "links to" part in the UI (right sidebar or lower area of left
sidebar like with vscode?) and a "linked to by" part where incoming links are
shown.

Posts need to support drag-and-drop image insert, and adding images must
automatically create the related media file entry, so that metadata for images
can easily be set in the UI, but users get their posts set up quickly without
lots of hassle. Images that are referenced by posts are also linked in metadata
to the post, so that we have full overview of what images a post references in the
actual post data. And that data is also included in the published post file on
the file system.

Linkage data must be recoverable from posts and image links must be discoverable
from post text, too, so that a blog can be repaired if anything goes wrong.
There must be a strong focus on being indestructible for the blog, the most that
could get lost can be draft content, but everything published must be fully
recoverable from data on the file system.

### default category "article"

This is for articles that are focused on long text. They will show fully only on
the full page, but will be summarized in overview pages.

### category "picture"

This is a variant of article with less text-focus but usually a strong focus on
attached images. This will show the image in a wide format if it is just one, or
a gallery view, if it is multiple images and will only show thumbnails for
overviews. This means we will need a library to manage image sizes properly for
thumbnails during media storage. Those thumbnails must be created automatically.

### category "aside"

This is a short-form article that does not need a full-article-page, because it
will just be a link and a short comment that is shown after the link. This is
meant for link collections and should be rendered in a compact form in the
overview pages. More on rendering in the publishing pipelin description.
overview pages. More on rendering in the publishing pipeline description.

### category "page"

This is a post that behaves mostly like an article, but is ignored in overview
pages, because it is just meant to be linked to menues. So menu editing needs to
pages, because it is just meant to be linked to menus. So menu editing needs to
be able to reference posts of category page and overview templates need to
ignore posts of category page. Other than that, they are just like article, so
have long form text, short form summary and title. Pages can be assigned
different header images that override the project image.

### Project definition

A project is not just the collection of posts, media and publish settings, it is
also a base project container with title, author and other elements like that.
So there needs to be project related settings that allow to give the project a
title, set up a main author that can be referenced in metadat and for example
title, set up a main author that can be referenced in metadata and for example
set up header images that can be used when publishing.

## Migrating

Prepare and continue improving the mass-data importer that reads WordPress backup files, so the
user can bring in old wordpress blogs easily. The importer should run
asynchronously and properly communicate progress to the user while it is running
in the background. The import has to rebuild all metadata properly, so check if
we have all the metadata in our model set up in a similar way as Wordpress
handles it, so that we have a seamless integration. Posts in WordPress backups
are HTML, but should be interpreted and transformed into proper markdown in the
import.

In general, HTML elements of the post have to all be transformed into markdown
equivalents, and not use embedded HTML, for as much as possible. We want clean
markdown in the posts after the import, not a mix of markdown and HTML.

For AI support during import to work, the blog application needs to provide
post management and media management functionality as proper AI tools to the
OpenCode Zen API, so that it will be able to work on those posts.

The AI importing agent must discover the language of a post and put that in an
attribute. Posts must have the database structure of translations, so that a
post that is discovered as being german can be automatically translated to
English and vice-versa. After import, all posts are available in two languages.

Another thing the AI importing agent must do is create summaries of posts to put
into a summary attribute on posts in the database, so that those can be used in
overview pages if needed (usually that is the case for article-type posts).

Imports must be able to recognize duplicates of posts to some degree, so that we
don't create additional posts from new import runs if the original posts are
already there. In the case of recognized duplicates, the original post will just
be linked to the same tag of the new import, so that the user can see it was
referenced by multiple imports.

Essentially my main idea for imports is that the importer is classes that can
read websites from different sources (starting with WordPress backup and HTTP URL)
and that each discovered element is handed to the AI to convert to markdown and
in the case of the HTTP URL also separate out posts, then use the tools to check
for duplicates and update tags or create new posts based on the process.

Import runs can be shown in the main panel, so that the user can see what came
with what import and can manage posts and media from imports that way. Migration
is the main interesting part of this tool, because migrating blogs is hard work
and needs to be properly supported.

Migrating posts puts them into published state directly, not draft state,
because that would make the database explode. The whole point of migration is to
get those posts into a published state as soon as possible.

## Organizing II

Since we have an AI assistant planned for the migration phase, we also want an
AI chat feature as another view in the app, so we can activate it and use the AI
assistant to query blog posts and media files in the system and also create blog
posts with AI support.

All SDK tools must also be made available as MCP server that is hosted inside
the application, so that I can hook the app into a normal AI coding agent.

Also the AI should be available to create summaries just with a button click in
the post editor area, so that the summary is filled in based on AI summarization
to help speed up the blogging process. Also the AI can be used to generate a
good slurl that is not just generically from the title and even the title can be
good slug that is not just generically from the title and even the title can be
AI-generated from the text. That way the user can focus on writing the core text
and if all matches, just accept AI summary and title and post it.

## Previewing

There is an integrated web server that can be opened from the file menu
in a browser (menu item "open in browser" starts the default browser with the
localhost URL) to look at what the site would look like after publishing. The
preview should run live through what the exporter would do to each page
that is sent to the server. This gives a proper preview of things to come.

Preview should include draft content, so that even before publishing the user
can see what will be there after publishing. Also this will allow
background-publishing to automatically happen when new content is put into
publish state, if we want that later.

## Publishing

Publishing should target static HTML/CSS/JavaScript situations. There must be a
async exporter, that will render all affected pages based on the structure of
the export and auto-update affected files when the posts or media that are used
in the page were changed. This requires a cross-reference table that links posts
and media entries with actual HTML files that are referencing them. This needs
to be based on how templates use posts in the export pipeline.

Essentially the publishing pipeline knows what posts changed since last
publishing (maybe a version number that is pulled from a central place, so that
any change will raise that version and any post and media that has a higher
version number of the last publish run is seen as changed) and will run the
relevant templates to recreate all linked pages of the publishing (single post
pages for the post but also many overview pages) and of course each page is only
updated once in the publishing run, collecting all changed posts for that.

The main driver is a proper blog structure with templates. For this I want
proper templates I can manage and edit in the application itself. Template
editing should provide proper syntax highlighting, so something like monaco is
important. Choose a good solid template engine for Node.js-based tools that is
especially targeted to easy template creation.

For the styling I want the system to be based on css templates, so that the look
can be easily swapped to the wish of the user. There should be a selection of
light and dark themes bundled with the application, so that starting is simple.
New css templates must be easily integrateable into the application, maybe even
New CSS templates must be easily integrable into the application, maybe even
with easy importing from a central repository site or something like that. I
think Pico CSS is a good choice, since it sticks to semantic HTML and
auto-adapts to light/dark mode settings of users. I want to work minimalist, but
still allow some style influence into the site based on user prefs.

Check the site https://hugo.rfc1437.de/ for its structure, this is the structure
of blog I want to be capable of building with this tooling. So we need templates
for overview pages and ways to manage menus that reference overview pages and
structure the menu according to site structure. Also support calendar views to
allow users to go to specific months and years of the blog. Build up a sensible
set of templates that come with a new project, so that the user can start right
away without a lot of hassle. Base the templates on the structure of above
website, but keep out website title and images, of course.

Categories and tags must be able to define a template selection for post
templates, so that different types can be represented differently. this is
templates, so that different types can be represented differently. This is
especially important for the standard categories "article", "picture" and
"aside", as they should come right away with templates for their article page
and their use in overviews. Every post can define via category or tag
(tag-related templates override category templates but can be overridden via
article-specific template selections).

There must be way to open a browser tab in the application that then uses the
application itself and does dynamic rendering of the content, using the same
templates and everything else, so that the user can do a proper preview before
deciding to update the remote static web storage. The browser tab will of course
use the correct styling of the website.

Publishing of files can be configured to be done via FTP or SSH, connection data
must be configurable in preferences for the website.
