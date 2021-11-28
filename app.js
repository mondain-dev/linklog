var fs = require('fs');
var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var toml = require('@iarna/toml');
var cheerio = require("cheerio");
var RSSParser = require('rss-parser');
let rssParser = new RSSParser();
var RSS = require('rss');

var got = require('got');
var unfurl = require('unfurl.js').unfurl

const TimeOutInMS = 5000;

function getLinkContentFromUnfurlObj(obj){
    let linkDescription = "";
    let imgDescription = "";
    if(!imgDescription){
        try {
            imgDescription = "<p><img src=\"" + obj.open_graph.images[0].url + "\"></p>";
        }
        catch(error){
        }
    }
    if(!imgDescription){
        try {
            imgDescription = "<p><img src=\"" + obj.twitter_card.images[0].url + "\" alt=\"" + obj.twitter_card.images[0].alt +  "\"></p>";
        }
        catch(error){
        }
    }
    let textDescription = "";
    if(!textDescription){
        try{
            // linkDescription += obj.oEmbed.html.replace(/<script.*>,*<\/script>/ims, " ");
            if('open_graph' in obj){
                if('title' in obj.open_graph){
                    textDescription += '<p>' + obj.open_graph.title + '</p>';
                }
                if('description' in obj.open_graph){
                    textDescription += '<p>' + obj.open_graph.description + '</p>';
                }
            }
        }
        catch (error){
        }
    }
    if(!textDescription){
        try{
            // linkDescription += obj.oEmbed.html.replace(/<script.*>,*<\/script>/ims, " ");
            if('twitter_card' in obj){
                if('title' in obj.twitter_card){
                    textDescription += '<p>' + obj.twitter_card.title + '</p>';
                }
                if('description' in obj.twitter_card){
                    textDescription += '<p>' + obj.twitter_card.description + '</p>';
                }
            }
        }
        catch (error){
        }
    }
    if(!textDescription){
        try{
            // linkDescription += obj.html.replace(/<script.*>,*<\/script>/ims, " ");
            textDescription += '<p>' + obj.title+ '</p>';
        }
        catch (error){
        }
    }
    linkDescription = imgDescription + textDescription;
    return linkDescription;
}

let renderTweetFromUnfurlObj = getLinkContentFromUnfurlObj;

async function getLinkTitleFromUnfurlObj(obj){
    let linkTitle = "";
    if(!linkTitle){
        try{
            linkTitle = obj.open_graph.title;
        }
        catch (error){
        }    
    }
    if(!linkTitle){
        try{
            linkTitle = obj.twitter_card.title;
        }
        catch (error){
        }
    }
    if(!linkTitle){
        try{
            linkTitle = obj.title;
        }
        catch (error){
        }
    }
    return linkTitle;
}

async function extractJSONLDTitle(html){
    let linkTitle = "";
    let $ = cheerio.load(html);
    if($('script[type="application/ld+json"]').length){
        for( el of $('script[type="application/ld+json"]') ){
            ld = JSON.parse($(el).html())
            if('@type' in ld){
                if(ld['@type'] == "NewsArticle" && 'headline' in ld)
                {
                    linkTitle = ld['headline']
                }
            }
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

let extractTitle = (strHTML) => {
    const $ = cheerio.load(strHTML);
    if($('.embedded-post-title').length){
        return $('.embedded-post-title').first().text();
    }

    texts = strHTML.trim().replace(/(<([^>]+)>)/ig, '\n').split('\n').map(e => e.trim()).filter(Boolean);
    if(texts){
        return texts[0].trim();
    }
    else{
        return '';
    }
}

let extractLinks = async (entry, excludes, cssSelector = 'a') => {
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
                    let linkGotObj;
                    let linkUnfurlObj;
                    let linkContentType = '';
                    let linkHTML = '';

                    // linkTitle
                    let linkTitle = extractTitle($(el).html());
                    if(validateURL(linkTitle) || !linkTitle){
                        if(!linkContentType){
                            try{
                                linkGotObj = await got(linkURL);
                                linkContentType = linkGotObj.headers['content-type'];
                                if(linkContentType.startsWith("text/html")){
                                    linkHTML = linkGotObj.body;
                                }
                            }
                            catch(error){}
                        }
                        if(linkContentType.startsWith("text/html")){
                            linkTitle = await extractJSONLDTitle(linkHTML);
                        }
                    }                    
                    if(!linkTitle){
                        try {
                            if(!linkUnfurlObj)
                            {
                                if(!linkContentType){
                                    linkGotObj = await got(linkURL);
                                    linkContentType = linkGotObj.headers['content-type'];
                                }
                                if (linkContentType.startsWith("text/html"))
                                {
                                    linkUnfurlObj = await unfurl(linkURL, {timeout: TimeOutInMS});
                                    linkTitle = getLinkTitleFromUnfurlObj(linkUnfurlObj);
                                }
                            }
                        }
                        catch(error){}
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
                        try {
                            if(!linkUnfurlObj)
                            {
                                if(!linkContentType){
                                    linkGotObj = await got(linkURL);
                                    linkContentType = linkGotObj.headers['content-type'];
                                }
                                if (linkContentType.startsWith("text/html"))
                                {
                                    linkUnfurlObj = await unfurl(linkURL, {timeout: TimeOutInMS});
                                }
                            }
                        }
                        catch(error){}
                        let tweetContent = renderTweetFromUnfurlObj(linkUnfurlObj);
                        linkContent = tweetContent + linkContent;
                    } else if (linkURL == linkTitle){
                        try {
                            if(!linkContentType){
                                try{
                                    linkGotObj = await got(linkURL);
                                    linkContentType = linkGotObj.headers['content-type'];
                                }
                                catch(error){}
                            }
                            if (linkContentType.startsWith("image"))
                            {
                                linkContent = '<p><img src="' + linkURL + '"></p>' + linkContent;
                            }
                        }
                        catch(error){
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
                if(includeEntry){
                    let extractedLinks = await extractLinks(entry, f.link.excludes, f.link.selector);
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
