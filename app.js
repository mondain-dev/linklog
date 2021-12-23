var fs = require('fs');
var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var toml = require('@iarna/toml');
var cheerio = require("cheerio");
var RSSParser = require('rss-parser');
let rssParser = new RSSParser();
var RSS = require('rss');
var sw = require('stopword');

var config = require('./config.json')
var LinkContent = require('./LinkContent.js')

const customStopWords = fs.existsSync('./stopwords.txt') ? fs.readFileSync('./stopwords.txt', 'utf-8').split('\n').filter(Boolean) : [];
const customStopRegex = fs.existsSync('./stopregex.txt') ? fs.readFileSync('./stopregex.txt', 'utf-8').split('\n').filter(Boolean).map((s)=>{return new RegExp(s);}) : [];
function titleIsStopWord(title){
    let title_ = title.toLocaleLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g," ").trim()
    let result = false;
    result = customStopRegex.some((s)=>{return s.exec(title_)});
    if(!result)
    {
        if(sw.removeStopwords(title_.split(' ').filter(Boolean), [...sw.en, ...sw.fr, ...customStopWords]).length == 0)
        {
            result = true;
        }
    }
    return result;
}

function validateURL(string) {
    try {
      let url = new URL(string);
    } catch (_) {
      return false;  
    }
    return true;
}

let titleIsURL = (title, url) => {
    if(validateURL(title))
    {
        return true;
    }
    if(url.replace(/^[a-zA-Z]*:\/\//, '').startsWith(title.replace(/(…$)|(\.+$)/, '').trim())){
        return true;
    }
    if(url.replace(/^[a-zA-Z]*:\/\/www\./, '').startsWith(title.replace(/(…$)|(\.+$)/, '').trim())){
        return true;
    }
    return false;
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
                    let linkContent;
                    // linkTitle
                    let linkTitle = '';
                    if(useLinkText)
                    {
                        linkTitle = extractLinkText($(el).html());
                    }
                    if(!linkTitle || titleIsURL(linkTitle, linkURL) || titleIsStopWord(linkTitle)){
                        if(!linkContent){
                            linkContent = new LinkContent(linkURL, config);
                        }
                        linkTitle = await linkContent.getTitle();
                        if (parseURL(linkURL).host.toLocaleLowerCase() != parseURL(linkContent.url).host.toLocaleLowerCase()){
                            linkURL = linkContent.url;
                        }
                    }
                    // if(!linkTitle){
                    //     linkTitle = linkURL;
                    // }
                    
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
                    // else if (titleIsURL(linkTitle, linkURL)){
                    //     if(!linkContent){
                    //         linkContent = new LinkContent(linkURL, config);
                    //     }
                    //     linkDescription = await linkContent.renderContent()
                    // }

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
                        //console.log(linkDescription);
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
                    let extractedLinks = await extractLinks(entry, f.link.excludes, f.link.selector, useLinkText);
                    entries.push(...extractedLinks);
                }
            }
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
