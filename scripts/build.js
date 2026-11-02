
import * as path from "node:path"
import * as fs from "node:fs"
import {DOMParser, XMLSerializer} from "@xmldom/xmldom"

const SOURCE_DIR = "wiki"
const OUTPUT_DIR = "dist"

const ENCODING = "utf8"

const PARSER = new DOMParser()

const TAG_MAP = {
    article: "div",
    title: "h1",
    heading: "h2",
    paragraph: "p",
    b: "strong",
    i: "em",
    link: "a"
}

const PAGE_REGISTRY = new Map()
PAGE_REGISTRY.set("home", "/index.html")

validate_sources()

const TEMPLATE = PARSER.parseFromString(
    fs.readFileSync(`${SOURCE_DIR}/template.html`, {encoding: ENCODING}),
    "application/xml"
)

validate_template()

print(`Creating wiki tree from ${SOURCE_DIR}'s content..`)
const WIKI_TREE = build_wiki_tree()

print(`Creating page registry from wiki tree contents..`)
register_pages(WIKI_TREE)

print(`Building wiki pages and assets to ${OUTPUT_DIR}..`)
build_wiki(WIKI_TREE)


// Recursively builds a tree of the wiki pages and assets
function build_wiki_tree(dir = SOURCE_DIR, relative_path = "") {
    const entries = fs.readdirSync(dir, {withFileTypes: true})

    const node = {
        type: "category",
        name: path.basename(relative_path),
        path: relative_path,
        children: [],
    }

    entries.forEach(entry => {
        const entry_path = path.join(dir, entry.name)
        const relative_entry_path = path.join(relative_path, entry.name)

        if (entry.isDirectory()) {
            node.children.push(
                build_wiki_tree(entry_path, relative_entry_path)
            )

            node.children.sort((a, b) =>
                (b.type === "category") - (a.type === "category")
            )

        } else if (entry.isFile()) {

            if (entry.name.toLowerCase().endsWith(".xml")) {
                node.children.push({
                    type: "page",
                    name: path.basename(entry.name, path.extname(entry.name)),
                    path: relative_entry_path,
                    children: [],
                })

            } else if (entry.name === "template.html") {
                // Ignore template.html

            } else if (entry.name.toLowerCase().endsWith(".css")) {
                node.children.push({
                    type: "asset",
                    name: entry.name,
                    path: relative_entry_path,
                })

            } else {
                print_err(`Unsupported entry: ${entry.name}`)
            }
        }
    })

    return node
}


// Registers all wiki pages and their output URLs
function register_pages(tree) {
    for (const entry of tree.children) {

        if (entry.type === "category") {
            register_pages(entry)

        } else if (entry.type === "page") {
            const url = "/" + entry.path
                .replaceAll("\\", "/")
                .replace(/\.xml$/i, ".html")

            PAGE_REGISTRY.set(entry.name, url)
        }
    }
}


// Builds wiki pages and copies static assets
function build_wiki(tree) {
    tree.children.forEach(entry => {

        if (entry.type === "category") {
            build_wiki(entry)

        } else if (entry.type === "page") {
            const output_path = path.join(
                OUTPUT_DIR,
                entry.path.replace(/\.xml$/i, ".html")
            )

            fs.mkdirSync(path.dirname(output_path), {
                recursive: true
            })

            const xml = fs.readFileSync(
                path.join(SOURCE_DIR, entry.path),
                {encoding: ENCODING}
            )

            const html = parse_xml_to_html(xml)

            fs.writeFileSync(output_path, html, ENCODING)

        } else if (entry.type === "asset") {
            const source_path = path.join(
                SOURCE_DIR,
                entry.path
            )

            const output_path = path.join(
                OUTPUT_DIR,
                entry.path
            )

            fs.mkdirSync(path.dirname(output_path), {
                recursive: true
            })

            fs.copyFileSync(source_path, output_path)

            print(`Copied asset: ${entry.path}`)
        }
    })
}


function parse_xml_to_html(xml) {
    const article = PARSER.parseFromString(
        xml,
        "application/xml"
    ).documentElement

    const page = TEMPLATE.cloneNode(true)

    const content = find_by_id(page, "content")
    const title_element = find_by_id(page, "title")

    title_element.textContent =
        article.getElementsByTagName("title")[0].textContent

    for (const child of article.childNodes) {
        const rendered = render_node(child, page)

        if (rendered) {
            content.appendChild(rendered)
        }
    }

    return new XMLSerializer().serializeToString(page)
}


// Renders XML nodes into HTML nodes
function render_node(child, output) {

    // Text node
    if (child.nodeType === 3) {
        return output.createTextNode(child.nodeValue)
    }

    // Anything that isn't a normal tag/node
    if (child.nodeType !== 1) {
        return null
    }

    const html_tag = TAG_MAP[child.tagName]

    if (!html_tag) {
        throw new Error(`Unknown XML element: ${child.tagName}`)
    }

    const element = output.createElement(html_tag)

    if (child.tagName === "link") {
        const page_name = child.getAttribute("page")
        const url = PAGE_REGISTRY.get(page_name)

        if (!url) {
            throw new Error(`Unknown wiki page: ${page_name}`)
        }

        element.setAttribute("href", url)
    }

    for (const child_child of child.childNodes) {
        const rendered = render_node(child_child, output)

        if (rendered) {
            element.appendChild(rendered)
        }
    }

    return element
}


function find_by_id(document, id) {
    const elements = document.getElementsByTagName("*")

    for (let i = 0; i < elements.length; i++) {
        if (elements[i].getAttribute("id") === id) {
            return elements[i]
        }
    }

    return null
}


function validate_sources() {
    if (!fs.existsSync(SOURCE_DIR)) {
        fs.mkdirSync(SOURCE_DIR)

        print_err(
            `SOURCE_DIR ${SOURCE_DIR} did not exist, thus no files were present to parse`
        )

        process.exit(1)
    }

    if (!fs.existsSync(`${SOURCE_DIR}/template.html`)) {
        print_err(
            `SOURCE_DIR ${SOURCE_DIR} does not contain a template.html file, please create one`
        )

        process.exit(1)
    }

    if (fs.existsSync(OUTPUT_DIR)) {
        fs.rmSync(OUTPUT_DIR, {
            recursive: true
        })
    }

    fs.mkdirSync(OUTPUT_DIR, {
        recursive: true
    })
}


function validate_template() {
    if (!find_by_id(TEMPLATE, "content")) {
        print_err(
            `${SOURCE_DIR}/template.html is missing an element with id="content"`
        )

        process.exit(1)
    }

    if (!find_by_id(TEMPLATE, "title")) {
        print_err(
            `${SOURCE_DIR}/template.html is missing an element with id="title"`
        )

        process.exit(1)
    }
}


function print_err(msg) {
    console.error(`[ERROR] ${msg}`)
}


function print(msg) {
    console.log(`[INFO] ${msg}`)
}
