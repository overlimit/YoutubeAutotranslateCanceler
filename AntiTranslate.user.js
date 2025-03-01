// ==UserScript==
// @name         Youtube Auto-translate Canceler
// @namespace    https://github.com/pcouy/YoutubeAutotranslateCanceler/
// @version      0.4
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy
// @match        https://www.youtube.com/*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// ==/UserScript==

(async () => {
    'use strict';

    /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
    var NO_API_KEY = false;
    var api_key_awaited = await GM.getValue("api_key");
    if(api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === ""){
        await GM.setValue("api_key", prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."));
    }

    api_key_awaited = await GM.getValue("api_key");
    if(api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === ""){
        NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
        console.log("NO API KEY PRESENT");
    }
    const API_KEY = await GM.getValue("api_key");
    var API_KEY_VALID = false;
		//console.log(API_KEY);

    var url_template = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

    var cachedTitles = {} // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay

    var currentLocation; // String: Current page URL
    var changedDescription; // Bool: Changed description
    var pageDescTrigger = false;

    function getVideoID(a)
    {
        while(a.tagName != "A"){
            a = a.parentNode;
        }
        var href = a.href;
        var tmp = href.split('v=')[1];
        tmp = tmp == null ? href.split('/shorts/')[1] : tmp;
        return tmp.split('&')[0];
    }

    function resetChanged(){
        console.log(" --- Page Change detected! --- ");
        currentLocation = document.title;
        changedDescription = false;
    }
    resetChanged();

    function changeTitles(){
        if(currentLocation !== document.title) resetChanged();

        if (NO_API_KEY) {
            return;
        }

        // REFERENCED VIDEO TITLES - find video link elements in the page that have not yet been changed
        var links = Array.prototype.slice.call(document.getElementsByTagName("yt-formatted-string")).filter( a => {
            return (a.id == 'video-title' || a.id == 'video-title-link')
            && !a.className.includes("ytd-video-preview") && !a.className.includes("ytd-ad-inline-playback-meta-block") && cachedTitles[getVideoID(a)] !== a.innerText.trim();
        } );
        var spans = Array.prototype.slice.call(document.getElementsByTagName("span")).filter( a => {
            return (a.id == 'video-title' || a.id == 'video-title-link')
            && !a.className.includes("-radio-")
            && !a.className.includes("-playlist-")
            && cachedTitles[getVideoID(a)] !== a.innerText.trim();
        } );
        links = links.concat(spans).slice(0,30);

        // change title from cachedTitles
        var needReqLinks = [];
        for(var i=0 ; i < links.length ; i++){
            var curCachedTitle = cachedTitles[getVideoID(links[i])];
            if (curCachedTitle !== undefined) {
                var displayTitle = links[i].innerText.trim();
                if(displayTitle != curCachedTitle.replace(/\s{2,}/g, ' '))
                {
                    console.log ("'" + displayTitle + "' --> '" + curCachedTitle + "'");
                    links[i].innerText = curCachedTitle;
                }
            } else {
                needReqLinks.push(links[i]);
            }
        }
        links = needReqLinks;

        // MAIN VIDEO DESCRIPTION - request to load original video description
        var mainVidID = "";
        if (!changedDescription && window.location.href.includes ("/watch")){
            mainVidID = window.location.href.split('v=')[1].split('&')[0];
        }

        if(mainVidID != "" || links.length > 0)
        { // Initiate API request

            console.log("Checking " + (mainVidID != ""? "main video and " : "") + links.length + " video titles!");

            // Get all videoIDs to put in the API request
            var IDs = links.map( a => getVideoID (a));
            var APIFetchIDs = IDs.filter(id => cachedTitles[id] === undefined);
            var requestUrl = url_template.replace("{IDs}", (mainVidID != ""? (mainVidID + ",") : "") + APIFetchIDs.join(','));

            // Issue API request
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function ()
            {
                if (xhr.readyState === 4)
                { // Success
                    var data = JSON.parse(xhr.responseText);

                    if(data.kind == "youtube#videoListResponse")
                    {
                        API_KEY_VALID = true;
                        data = data.items;
                        if (mainVidID != "") {
                            // MAIN TITLE
                            var nativeMainTitle = data[0].snippet.title;
                            document.title = nativeMainTitle + " - YouTube";
                            var pageTitle = document.getElementsByClassName("title style-scope ytd-video-primary-info-renderer");
                            if (pageTitle.length > 0 && pageTitle[0] !== undefined && nativeMainTitle != null && pageTitle[0].innerText != nativeMainTitle) {
                                    console.log ("Reverting main video title '" + pageTitle[0].innerText + "' to '" + nativeMainTitle + "'");
                                    pageTitle[0].innerText = nativeMainTitle;
                            }
                            // Replace Main Video Description
                            var videoDescription = data[0].snippet.description;
                            var pageDescription = document.getElementsByClassName("yt-core-attributed-string yt-core-attributed-string--white-space-pre-wrap");
                            if (pageDescription.length > 1 && videoDescription != null && pageDescription[1] !== undefined) {
                                // linkify replaces links correctly, but without redirect or other specific youtube stuff (no problem if missing)
                                // Still critical, since it replaces ALL descriptions, even if it was not translated in the first place (no easy comparision possible)
                                if (!pageDescTrigger) {
                                    pageDescTrigger = true;
                                    revertVideoDesc(videoDescription, pageDescription);
                                    console.log("start interval revert desc")
                                    setInterval(revertVideoDesc, 10000, videoDescription, pageDescription);
                                }
                                changedDescription = true;
                            }
                            else console.log ("Failed to find main video description!");
                        }

                        // Create dictionary for all IDs and their original titles
                        data = data.forEach( v => {
                            cachedTitles[v.id] = v.snippet.title;
                        } );

                        // Change all previously found link elements
                        for(var i=0 ; i < links.length ; i++){
                            var curID = getVideoID(links[i]);
                            if (curID !== IDs[i]) { // Can happen when Youtube was still loading when script was invoked
                                console.log ("YouTube was too slow again...");
                                changedDescription = false; // Might not have been loaded aswell - fixes rare errors
                            }
                            if (cachedTitles[curID] !== undefined)
                            {
                                var originalTitle = cachedTitles[curID];
                                var displayTitle = links[i].innerText.trim();
                                if(displayTitle != originalTitle.replace(/\s{2,}/g, ' '))
                                {
                                    console.log ("'" + displayTitle + "' --> '" + originalTitle + "'");
                                    links[i].innerText = originalTitle;
                                }
                            }
                        }
                    }
                    else
                    {
                        console.log("API Request Failed!");
                        console.log(requestUrl);
                        console.log(data);

                        // This ensures that occasional fails don't stall the script
                        // But if the first query is a fail then it won't try repeatedly
                        NO_API_KEY = !API_KEY_VALID;
                        if (NO_API_KEY) {
                            GM_setValue('api_key', '');
                            console.log("API Key Fail! Please Reload!");
                        }
                    }
                }
            };
            xhr.open('GET', requestUrl);
            xhr.send();

        }
    }

    function revertVideoDesc (videoDescription, pageDescription) {
        pageDescription[1].innerHTML = linkify(videoDescription);
        console.log ("Reverting main video description!");
    }

    function linkify(inputText) {
        var replacedText, replacePattern1, replacePattern2, replacePattern3;

        //URLs starting with http://, https://, or ftp://
        replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
        replacedText = inputText.replace(replacePattern1, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="$1">$1</a>');


        //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
        replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
        replacedText = replacedText.replace(replacePattern2, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="http://$1">$1</a>');

        //Change email addresses to mailto:: links.
        replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
        replacedText = replacedText.replace(replacePattern3, '<a class="yt-simple-endpoint style-scope yt-formatted-string" spellcheck="false" href="mailto:$1">$1</a>');

        return replacedText;
    }

    // Execute every seconds in case new content has been added to the page
    // DOM listener would be good if it was not for the fact that Youtube changes its DOM frequently
    setInterval(changeTitles, 1000);
})();

