var URL = require('whatwg-url').URL
var parseURL = require("whatwg-url").parseURL;

var fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
var AbortController = require("node-abort-controller").AbortController;

var htmlEncodingSniffer = require("html-encoding-sniffer");
var whatwgEncoding = require("whatwg-encoding");
var metascraper = require('metascraper')([
    require('metascraper-description')(),
    require('metascraper-image')(),
    require('metascraper-title')()
])

var cheerio = require('cheerio')

var pjson  = require('./package.json');
const userAgent   = pjson.name + "/" + pjson.version;
const userEmail   = (process.env.GITHUB_ACTOR || 'github-pages-deploy-action') + '@users.noreply.' + 
                    (process.env.GITHUB_SERVER_URL ? parseURL(process.env.GITHUB_SERVER_URL).host : 'github.com')

class LinkContent{
    constructor(url, config) {
      this.url = url;
      this.config = config;
      
      this.urlParsed = parseURL(url);
      
      this.response = null;
      this.contentType = ''; 
      this.html = null;
      this.metadata = null;

      this.title = null;
      this.description = null;
      this.image = null;
    }

    getHeadersForURL(){
        if(this.config.domainsCustomUserAgent.some((s)=>{return this.urlParsed.host == s || this.urlParsed.host.endsWith('.'+s)}))
        {
            return {'User-Agent': userAgent, 'From': userEmail};
        }
        else{
            return {'User-Agent': 'facebookexternalhit'};
        }
    }

    async fetchUrl(){
        const controller = new AbortController();
        const timeout = setTimeout(() => {controller.abort();}, 5000);
        try{
            this.response = await fetch(this.url, {headers: this.getHeadersForURL(), signal: controller.signal});
            this.contentType = this.response.headers.get('content-type');
            if(this.config.domainsUseScraper.every((s)=>{return parseURL(this.url).host != s && !parseURL(this.url).host.endsWith('.'+s)})){
                this.url = this.response.url;
            }
            this.urlParsed = parseURL(this.url);
        }
        catch(error){
            console.log('fetch(' + this.url + ') failed.');
        }
        finally{
            clearTimeout(timeout);
        }
    }

    // async getHTMLApify(){
    //     let endpoint = new URL(this.config.endpointApify); 
    //     endpoint.searchParams.append("token", process.env.APIFY_API_KEY);
    //     let input    = {
    //         "requestListSources": [
    //             {
    //                 "url": this.url
    //             }
    //         ],
    //         "proxyConfiguration": {
    //             "useApifyProxy": true,
    //             "apifyProxyCountry": "US"
    //         },
    //         "useChrome": false
    //     }
    //     let res = await fetch(endpoint.href, {
    //         method: 'post',
    //         body: JSON.stringify(input),
    //         headers: {'Content-Type': 'application/json'}
    //     });
    //     let buf = Buffer.from(await res.arrayBuffer());
    //     let data = JSON.parse(whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'})));
    //     return data[0].fullHtml;
    // }

    async getHTMLScraper(){
        let endpoint = new URL(this.config.endpointAPI); 
        endpoint.searchParams.append("api_key", process.env.SCRAPER_API_KEY);
        endpoint.searchParams.append("url", this.url);
        console.log(endpoint.href)
        let res = await fetch(endpoint.href);
        let buf = Buffer.from(await res.arrayBuffer());
        let html = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));
        // console.log(html);
        return html;
    }

    async getHTML(){
        if(this.html == null)
        {
            if(this.config.domainsUseScraper.some((s)=>{return this.urlParsed.host == s || this.urlParsed.host.endsWith('.'+s)}))
            {
                this.html = await this.getHTMLScraper();
            }
            else{
                if(!this.response){
                    await this.fetchUrl();
                }
                if(this.config.domainsUseScraper.some((s)=>{return this.urlParsed.host == s || this.urlParsed.host.endsWith('.'+s)}))
                {
                    this.html = await this.getHTMLScraper();
                }
                else if(this.contentType.startsWith('text/html')){
                    let buf = Buffer.from(await this.response.arrayBuffer());
                    this.html = whatwgEncoding.decode(buf, htmlEncodingSniffer(buf, {defaultEncoding: 'UTF-8'}));
                }
                else{
                    this.html = '';
                }
            }
        }
        return this.html;
    }

    async getMetaData(){
        if (!this.metadata)
        {
            this.metadata = await metascraper({html: await this.getHTML(), url: this.url});
        }
        return this.metadata;
    }

    async getTitle(){
        if(!this.response){
            await this.fetchUrl();
        }
        if(this.contentType.startsWith('text/html')){
            if(this.title == null)
            {
                if(this.html == null)
                {
                    await this.getHTML();
                }
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'headline' in ld)
                                {
                                    this.title = ld['headline'];
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.title == null)
            {
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.title = this.metadata.title;
            }
        }
        if(this.title == null)
        {
            this.title = "";
        }
        return this.title;
    }

    async getDescription(){
        if(!this.response){
            await this.fetchUrl();
        }
        if(this.contentType.startsWith('text/html')){
            if(this.description == null)
            {
                if(this.html == null)
                {
                    await this.getHTML();
                }
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'description' in ld)
                                {
                                    this.description = ld['description'];
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.description == null)
            {
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.description = this.metadata.description;
            }
        }
        if(this.description == null){
            this.description = "";
        }
        return this.description;
    }

    async getImage(){
        if(!this.response){
            await this.fetchUrl();
        }
        if(this.contentType.startsWith('text/html')){
            if(this.image == null)
            {
                if(this.html == null)
                {
                    await this.getHTML();
                }
                // ld+json
                let $ = cheerio.load(this.html);
                if($('script[type="application/ld+json"]').length){
                    for(let el of $('script[type="application/ld+json"]') ){
                        try{
                            let ld = JSON.parse($(el).html());
                            if('@type' in ld){
                                if(ld['@type'] == "NewsArticle" && 'image' in ld)
                                {
                                    this.image = ld['image'].url;
                                }
                            }    
                        }
                        catch(error){
                        }
                    }
                }
            }
            if(this.image == null)
            {
                if (!this.metadata)
                {
                    this.metadata = await metascraper({html: (await this.getHTML()), url: this.url});
                }
                this.image = this.metadata.image;
            }
        }
        else if (this.contentType.startsWith('image')){
            this.image = this.url;
        }

        if(this.image == null)
        {
            this.image == "";
        }
        return this.image;
    }

    async renderContent(){
        let imgDescription = ""
        let textDescription = "";
        if(this.response == null)
        {
            await this.fetchUrl();
        }
        if(this.contentType.startsWith('text/html')){
            if((await this.getImage())){
                imgDescription = "<p><img src=\"" + (await this.getImage()) + "\"></p>";
            }
            if((await this.getTitle()))
            {
                textDescription += '<p>' + (await this.getTitle()) + '</p>';
            }
            if((await this.getDescription())){
                textDescription += '<p>' + (await this.getDescription()) + '</p>';
            }
        }
        else if(this.contentType.startsWith('image')){
            imgDescription = "<p><img src=\"" + this.url + "\"></p>";
        }
        return imgDescription + textDescription;  
    }
}

module.exports = LinkContent;
