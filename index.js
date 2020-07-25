addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request))
})

/**
 * Checks if a valid oEmbed requests and passes to fetcher if so
 * @param {Request} request
 */
async function handleRequest(request) {
  // Deny non-GET requests (TODO: HEAD requests)
  if (request.method !== 'GET') {
    return new Response('Only GET supported; read-only', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }

  // Parse the request URL to get parameters
  const url = new URL(request.url)

  // Deny if no URL specified
  if (!url.searchParams.has('url')) {
    return new Response('url parameter required', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }

  // Parse the URL of the parameter
  let eoURL
  try {
    oeUrl = new URL(url.searchParams.get('url'))
  } catch (e) {
    return new Response('Invalid url', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }

  // Basic check to prevent abuse
  if (url.hostname !== oeUrl.hostname) {
    return new Response('Request and url hostnames must match', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    })
  }

  // Check format is JSON
  if (
    oeUrl.searchParams.has('format') &&
    oeUrl.searchParams.get('format') !== 'json'
  ) {
    return new Response('Only JSON oEmbed implemented', {
      status: 501,
      headers: { 'content-type': 'text/plain' },
    })
  }

  // Fetch page
  let page = await fetch(oeUrl)

  // Error fallback
  if (!page.ok) {
    console.log(`-> ${page.status} ${page.statusText}`)
    return page
  }

  // Find data
  let schema = {},
    metaTitle,
    metaByName = {},
    metaByProp = {},
    metaByItemProp = {}

  // If JSON data, assume Schema & use
  if (page.headers.get('Content-Type') === 'application/json') {
    let raw = await page.json()
    if (!Array.isArray(raw)) {
      schema = raw
    } else {
      // Look for known page types (so exclude WebSite and Person for example)
      raw.forEach((i) => {
        switch (i['@type']) {
          case 'Article':
          case 'BlogPosting':
          case 'ImageGallery':
          case 'Recipe':
          case 'TechArticle':
          case 'WebPage':
            schema = i
        }
      })
    }
  } else {
    // If HTML, extract Schema & Meta using HTMLRewriter
    let jsonRaw = ''
    await new HTMLRewriter()
      .on('head title', {
        element() {
          metaTitle = ''
        },
        text(text) {
          metaTitle += text.text
        },
      })
      .on('head meta[name]', {
        element(element) {
          metaByName[element.getAttribute('name')] = element.getAttribute(
            'content',
          )
        },
      })
      .on('head meta[property]', {
        element(element) {
          metaByProp[element.getAttribute('property')] = element.getAttribute(
            'content',
          )
        },
      })
      .on('head meta[itemprop]', {
        element(element) {
          metaByItemProp[
            element.getAttribute('itemprop')
          ] = element.getAttribute('content')
        },
      })
      .on('head script[type="application/ld+json"]', {
        text(text) {
          jsonRaw += text.text
        },
      })
      .transform(page)
      .text()

    // If found Schema, parse as JSON
    if (jsonRaw.length > 0) {
      try {
        schema = JSON.parse(jsonRaw)
      } catch (e) {
        return new Response('JSON-LD Schema could not be parsed', {
          status: 500,
          headers: { 'content-type': 'text/plain' },
        })
      }
    }
  }

  // Transform
  let oEmbedData = {
    type: 'link',
    version: '1.0',
  }

  // TODO: rewrite using Object & properties
  let optionalData = [
    [
      'title',
      schema.headline ??
        schema.name ??
        metaByProp['og:title'] ??
        metaByName['twitter:title'] ??
        metaByItemProp['name'] ??
        metaTitle,
    ],
    ['provider_name', metaByName['application-name']],
    ['author_name', metaByName['publisher']],
  ]

  optionalData.forEach((i) => {
    if (!oEmbedData[i[0]] && i[1] !== undefined) {
      oEmbedData[i[0]] = i[1]
    }
  })

  // Return data
  return new Response(JSON.stringify(oEmbedData), {
    headers: { 'content-type': 'application/json' },
  })
}
