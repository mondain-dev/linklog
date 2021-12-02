var fs = require('fs');
var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var toml = require('@iarna/toml');
var cheerio = require("cheerio");
var RSSParser = require('rss-parser');
let rssParser = new RSSParser();
var RSS = require('rss');
var sw = require('stopword');

var fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
var AbortController = require("node-abort-controller").AbortController;

var htmlEncodingSniffer = require("html-encoding-sniffer");
var whatwgEncoding = require("whatwg-encoding");
var metascraper = require('metascraper')([
    require('metascraper-description')(),
    require('metascraper-image')(),
    require('metascraper-title')()
])

var config = require('./config.json')
var pjson  = require('./package.json');
const userAgent   = pjson.version + "/" + pjson.version;
const userEmail   = (process.env.GITHUB_ACTOR || 'github-pages-deploy-action') + '@users.noreply.' + 
                    (process.env.GITHUB_SERVER_URL ? parseURL(process.env.GITHUB_SERVER_URL).host : 'github.com')

function isStopWordTitle(title){
    let title_ = title.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g," ").trim()
    let result = false;
    const  stopRegex = [/^links?$/, /^[a-z]+\s+link$/, 
                        /^([a-z]+\s+)?this$/, /^([a-z]+\s+)?t?here$/,
                        /(another|also)(\s+[a-z]+)?/,
                        /^([a-z]+\s+)?writes?$/, /^([a-z]+\s+)?wrote$/, 
                        /^([a-z]+\s+)?report(s|ed)?$/, /^([a-z]+\s+)?review(s|ed)?$/, 
                        /^([a-z]+\s+)?articles?$/, /^([a-z]+\s+)?news$/];
    const customStopWords = config.customStopWords;
    result = stopRegex.some((s)=>{return s.exec(title_)});
    if(!result)
    {
        if(sw.removeStopwords(title_.split(' ').filter(Boolean), [...sw.en, ...sw.fr, ...customStopWords]).length == 0)
        {
            result = true;
        }
    }
    return result;
}

function getHeadersForURL(url){
    let urlHost = parseURL(url).host;
    if(config.domainsCustomUserAgent.some((s)=>{return urlHost == s || urlHost.endsWith('.'+s)}))
    {
        return {'User-Agent': userAgent, 'From': userEmail};
    }
    else{
        return {'User-Agent': 'facebookexternalhit'};
    }
}

async function getHTMLApify(url){
    let endpoint = new URL(config.endpointApify); 
    endpoint.searchParams.append("token", process.env.APIFY_API_KEY);
    let input    = {
        "requestListSources": [
            {
                "url": url
            }
        ],
        "proxyConfiguration": {
            "useApifyProxy": true,
            "apifyProxyCountry": "US"
        },
        "useChrome": false
    }
    let res = await fetch(endpoint.href, {
        method: 'post',
        body: JSON.stringify(input),
        headers: {'Content-Type': 'application/json'}
    });
    let buf = Buffer.from(await res.arrayBuffer());
    let data = JSON.parse(whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'})));
    return data[0].fullHtml;
}

async function getPage(url){
    const controller = new AbortController();
    const timeout = setTimeout(() => {controller.abort();}, 5000);

    let res;
    try{
        res = await fetch(url, {headers: getHeadersForURL(url), signal: controller.signal});
    }
    catch(error){
        console.log('fetch(' + url + ') failed.');
    }
    finally{
        clearTimeout(timeout);
    }
    return res;
}

async function getLinkContentFromHTML(html, url){
    let linkDescription = "";
    let imgDescription = "";
    let textDescription = "";
    let metadata = await metascraper({html, url});
    if(metadata.image){
        imgDescription = "<p><img src=\"" + metadata.image + "\"></p>";
    }
    if(metadata.title)
    {
        textDescription += '<p>' + metadata.title + '</p>';
    }
    if(metadata.description){
        textDescription += '<p>' + metadata.description + '</p>';
    }
    linkDescription = imgDescription + textDescription;
    return linkDescription;
}

let renderTweetFromHTML = getLinkContentFromHTML;

async function getTitleFromHTML(html, url){
    let linkTitle = "";
    if(!linkTitle){
        let $ = cheerio.load(html);
        if($('script[type="application/ld+json"]').length){
            for( el of $('script[type="application/ld+json"]') ){
                try{
                    ld = JSON.parse($(el).html());
                    if('@type' in ld){
                        if(ld['@type'] == "NewsArticle" && 'headline' in ld)
                        {
                            linkTitle = ld['headline'];
                        }
                    }    
                }
                catch(error){
                }
            }
        }
    }
    if(!linkTitle){
        let metadata = await metascraper({html, url});
        if(metadata.title){
            linkTitle = metadata.title;
        }
    }
    return linkTitle;
}

function validateURL(string) {
    try {
      let url = new URL(string);
    } catch (_) {
      return false;  
    }
    return true;
}

let extractLinkText = (strHTML) => {
    const $ = cheerio.load(strHTML);
    if($('.embedded-post-title').length){
        return $('.embedded-post-title').first().text().trim();
    }

    texts = strHTML.trim().replace(/(<([^>]+)>)/ig, '\n').split('\n').map(e => e.trim()).filter(Boolean);
    if(texts){
        return texts[0].trim();
    }
    else{
        return '';
    }
}

let extractLinks = async (entry, excludes, cssSelector = 'a', useLinkText = true) => {
    let entryContent = '';
    if('content:encoded' in entry){
        entryContent = entry['content:encoded'];
    }
    else if('content' in entry){
        entryContent = entry['content'];
    }else if('description' in entry){
        entryContent = entry['description'];
    }
    let links = [];
    if(entryContent){
        const $ = cheerio.load(entryContent);
        for (let el of $(cssSelector)){
            if (excludes.every((t)=>{return !$(el).attr('href').includes(t) && !$(el).text().includes(t) })){
                let linkURL = $(el).attr('href');
                if (validateURL(linkURL))
                {
                    let res;
                    let linkContentType = '';
                    let linkHTML = '';
                    
                    // linkTitle
                    let linkTitle = ''
                    if(useLinkText)
                    {
                        linkTitle = extractLinkText($(el).html());
                    }
                    if(validateURL(linkTitle) || !linkTitle || isStopWordTitle(linkTitle.toLowerCase())){
                        if(!linkContentType){
                            try{
                                if(!res){
                                    res = await getPage(linkURL);
                                }
                                linkContentType = res.headers.get('content-type');
                                if(linkContentType.startsWith("text/html")){
                                    let urlHost = parseURL(linkURL).host;
                                    if(config.domainsUseApify.some((s)=>{return urlHost == s || urlHost.endsWith('.'+s)}))
                                    {
                                        linkHTML = await getHTMLApify(linkURL);
                                    }
                                    else{
                                        let buf = Buffer.from(await res.arrayBuffer());
                                        linkHTML = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));    
                                    }
                                }
                            }
                            catch(error){
                                console.log(error)
                            }
                        }
                        if(linkContentType.startsWith("text/html")){
                            linkTitle = await getTitleFromHTML(linkHTML, linkURL);
                        }
                    }
                    if(!linkTitle){
                        linkTitle = linkURL;
                    }
                    
                    // linkContent
                    let linkContent = "<p>URL: <a href=\"" + linkURL +"\">" + linkURL  + "</a></p><p>source: <a href=\"" + entry.link +"\">" + entry.title + "</a></p>";
                    if($('.embedded-post-body', el).length){
                        linkContent = '<p>' + $('.embedded-post-body', el).first().text() + '</p>' + linkContent;
                    }
                    else if (/twitter.com$/.test(parseURL(linkURL).host.toLocaleLowerCase())){
                        if(!linkHTML){
                            try {
                                if(!res){
                                    res = await getPage(linkURL);
                                }
                                linkContentType = res.headers.get('content-type');
                                if(linkContentType.startsWith("text/html")){
                                    let urlHost = parseURL(linkURL).host;
                                    if(config.domainsUseApify.some((s)=>{return urlHost == s || urlHost.endsWith('.'+s)}))
                                    {
                                        linkHTML = await getHTMLApify(linkURL);
                                    }
                                    else{
                                        let buf = Buffer.from(await res.arrayBuffer());
                                        linkHTML = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));    
                                    }                                    
                                }
                            }
                            catch(error){}
                        }
                        let tweetContent = await renderTweetFromHTML(linkHTML, linkURL);
                        linkContent = tweetContent + linkContent;
                    } else if (linkURL == linkTitle){
                        if(!linkContentType){
                            try {
                                if(!res){
                                    res = await getPage(linkURL);
                                }
                                linkContentType = res.headers.get('content-type');
                            }
                            catch(error){}                            
                        }
                        if (linkContentType.startsWith("image"))
                        {
                            linkContent = '<p><img src="' + linkURL + '"></p>' + linkContent;
                        }
                    }

                    let linkEntry = {
                        url: linkURL, 
                        title: linkTitle,
                        description: linkContent,
                        date: entry.pubDate,
                        author: entry.author,
                    };
                    if( ! links.map((e)=> {return e.url}).includes(linkEntry.url) ){
                        links.push(linkEntry);
                    }
                    //console.log(linkDescription);
                }
            } 
        }
    }
    return links;
}

let loadFeeds = async (feedConfig) => {
    let entries = [];
    for(const f of feedConfig)
    {
        await rssParser.parseURL(f.url).then( async (feedContent) => {
            for (let entry of feedContent.items)
            {
                let includeEntry = true;
                if('entry' in f){
                    if('includes' in f.entry){
                        if(!entry[f.entry.includes.target].toLowerCase().includes(f.entry.includes.keyword.toLowerCase())){
                            includeEntry = false;
                        }
                    }
                }
                if('recent' in f){
                    if ('pubDate' in entry && f.recent > 0){
                        if( Date.now() - Date.parse(entry.pubDate) > 3600 * 24 * 1000 * f.recent ){
                            includeEntry = false;
                        }
                    }               
                }
                let useLinkText = true;
                if('useLinkText' in f){
                    useLinkText = f.useLinkText;
                }
                if(includeEntry){
                    let extractedLinks = await extractLinks(entry, f.link.excludes, f.link.selector, useLinkText);
                    entries.push(...extractedLinks);
                }
            }
        });
    }
    // entries = await Promise.all(entries);
    return entries;
}

let feedConfig = toml.parse(fs.readFileSync('feeds.toml', 'utf8')).feeds;
let outputFeed = new RSS({title:"Linklog", feed_url:"https://mondain-dev.github.com/linklog/index.xml", site_url:"https://github.com/mondain-dev/linklog"});

loadFeeds(feedConfig).then((items) => {
    for(let item of items){
        outputFeed.item(item);
    }
}).then(() => {
    fs.writeFile('build/index.xml', outputFeed.xml(), function (err) {
        if (err) return console.log(err);});
});
