const fs = require('fs');
const parseURL = require("whatwg-url").parseURL;

const toml = require('@iarna/toml');
const cheerio = require("cheerio");

var pjson  = require('./package.json');
const userAgent   = pjson.name + "/" + pjson.version;
const userEmail   = (process.env.GITHUB_ACTOR || 'github-pages-deploy-action') + '@users.noreply.' + 
                    (process.env.GITHUB_SERVER_URL ? parseURL(process.env.GITHUB_SERVER_URL).host : 'github.com')
const RSSParser = require('rss-parser');
let rssParser = new RSSParser({
    headers: {'User-Agent': userAgent, 'From': userEmail},
});

const RSS = require('rss');
const { removeStopwords, eng, fra } = require('stopword')
const validUrl = require('valid-url');

const config = require('./config.json')
const LinkContent = require('./LinkContent.js')
const extractSection = require('./extractSection.js')

const customStopWords = fs.existsSync('./stopwords.txt') ? fs.readFileSync('./stopwords.txt', 'utf-8').split('\n').filter(Boolean) : [];
const customStopRegex = fs.existsSync('./stopregex.txt') ? fs.readFileSync('./stopregex.txt', 'utf-8').split('\n').filter(Boolean).map((s)=>{return new RegExp(s);}) : [];
function titleIsStopWord(title){
    let title_ = title.toLocaleLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g," ").trim()
    let result = false;
    result = customStopRegex.some((s)=>{return s.exec(title_)});
    if(!result)
    {
        if(removeStopwords(title_.split(' ').filter(Boolean), [...eng, ...fra, ...customStopWords]).length == 0)
        {
            result = true;
        }
    }
    return result;
}

let titleIsURL = (title, url) => {
    if(validUrl.isUri(title))
    {
        return true;
    }
    if(title.replace(/\s/g, '') == url){
        return true;
    }
    if(url.startsWith(title.replace(/\s/g, '').replace(/(…$)|(\.+$)/, ''))){
        return true;
    }
    if(url.replace(/^[a-zA-Z]*:\/\//, '').startsWith(title.replace(/\s/g, '').replace(/(…$)|(\.+$)/, ''))){
        return true;
    }
    if(url.replace(/^[a-zA-Z]*:\/\/www\./, '').startsWith(title.replace(/\s/g, '').replace(/(…$)|(\.+$)/, ''))){
        return true;
    }
    return false;
}

let extractEmbeddedTitle = (strHTML) => {
    const $ = cheerio.load(strHTML);
    if($('.embedded-post-title').length){
        return $('.embedded-post-title').first().text().trim();
    }
    return '';
}

let extractLinkText = (strHTML) => {
    texts = strHTML.trim().replace(/(<([^>]+)>)/ig, '\n').split('\n').map(e => e.trim()).filter(Boolean);
    if(texts.length){
        return texts[0].trim();
    }
    else{
        return '';
    }
}

let extractLinks = async (entry, excludes, cssSelector = 'a', sectionIncludes = null, useLinkText = true) => {
    if(!excludes){
        excludes = [];
    }
    let entryContent = '';
    if('content:encoded' in entry){
        entryContent = entry['content:encoded'];
    }
    else if('content' in entry){
        entryContent = entry['content'];
    }else if('description' in entry){
        entryContent = entry['description'];
    }
    if(sectionIncludes){
        let extractedSection = extractSection(entryContent, sectionIncludes);
        if(extractedSection){
            entryContent = extractedSection;
        }
    }
    let links = [];
    if(entryContent){
        const $ = cheerio.load(entryContent);
        for (let el of $(cssSelector)){
            if (excludes.every((t)=>{return !$(el).attr('href').includes(t) && !$(el).text().includes(t) })){
                let linkURL = $(el).attr('href');
                if (validUrl.isUri(linkURL) && linkURL.startsWith('http'))
                {
                    let linkContent;
                    // linkTitle
                    let linkTitle = extractEmbeddedTitle($(el).html());
                    if(!linkTitle && useLinkText)
                    {
                        linkTitle = extractLinkText($(el).html());
                    }
                    if(!linkTitle || titleIsURL(linkTitle, linkURL) || titleIsStopWord(linkTitle)){
                        if(!linkContent){
                            linkContent = new LinkContent(linkURL, config);
                        }
                        linkTitle = await linkContent.getTitle();
                    }
                    
                    // description
                    let linkDescription = ""
                    let linkSourceDescription = "<p>URL: <a href=\"" + linkURL +"\">" + linkURL  + "</a></p><p>source: <a href=\"" + entry.link +"\">" + entry.title + "</a></p>";
                    if($('.embedded-post-body', el).length){
                        linkDescription = '<p>' + $('.embedded-post-body', el).first().text() + '</p>';
                    }
                    else if (/twitter.com$/.test(parseURL(linkURL).host.toLocaleLowerCase())){
                        if(!linkContent){
                            linkContent = new LinkContent(linkURL, config);
                        }
                        linkDescription = await linkContent.renderContent()
                    } 

                    if(linkTitle){
                        let linkEntry = {
                            url: linkURL, 
                            title: linkTitle,
                            description: linkDescription + linkSourceDescription,
                            date: entry.pubDate,
                            author: entry.author,
                        };
                        if( ! links.map((e)=> {return e.url}).includes(linkEntry.url) ){
                            links.push(linkEntry);
                        }
                    }
                    else{
                        console.log("Not added: " + linkURL);
                    }
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
                        if(Array.isArray(f.entry.includes.target)){
                            if(f.entry.includes.target.filter((t)=> t in entry).every( (t) => ! entry[t].toLowerCase().includes(f.entry.includes.keyword.toLowerCase()))){
                                includeEntry = false;
                            }
                        }
                        else{
                            if(!entry[f.entry.includes.target].toLowerCase().includes(f.entry.includes.keyword.toLowerCase())){
                                includeEntry = false;
                            }    
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
                    let extractedLinks = await extractLinks(entry, [...f.link.excludes, config.domainsBlackList], f.link.selector, f.section ? f.section.includes : null, useLinkText);
                    entries.push(...extractedLinks);
                }
            }
        })
        .catch((error) => {
            console.error(error)
            console.error("feed: " + f.url);
            console.error("The Promise is rejected!", error);
        });
    }
    // entries = await Promise.all(entries);
    return entries;
}

let feedConfig = toml.parse(fs.readFileSync('feeds.toml', 'utf8'));
let outputFeed = new RSS({title: feedConfig.title, feed_url: feedConfig.url, site_url: feedConfig.site});

loadFeeds(feedConfig.feeds).then((items) => {
    for(let item of items){
        outputFeed.item(item);
    }
}).then(() => {
    fs.writeFile('build/index.xml', outputFeed.xml(), function (err) {
        if (err) return console.log(err);});
});
