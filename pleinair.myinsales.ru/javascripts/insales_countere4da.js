(function() {
    function readCookie(cookieName) {
      var cookies = document.cookie.split('; ');
      for (i = 0 ; i < cookies.length ; i++ ) {
        var cookie = cookies[i].split('=');
        if (cookie[0] == cookieName) {
          return unescape(cookie[1]);
        }
      }
      return "";
    };

    function setCookie(cookieName, cookieValue, msec_in_utc) {
        var expire = new Date(msec_in_utc);
        document.cookie = cookieName + "=" + escape(cookieValue) + ";path=/" +";expires=" + expire.toUTCString();
    };

    function getUrl(url) {
        if (window.XMLHttpRequest) {// code for IE7+, Firefox, Chrome, Opera, Safari
            xmlhttp = new XMLHttpRequest();
        } else {// code for IE6, IE5
            xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
        }
        xmlhttp.open("GET", url, true);
        xmlhttp.send();
    };

    // Bots can eval JS. We should not count bot visits.
    function isHuman() {
        var bots = navigator.userAgent.toLowerCase().match(/(googlebot|bingbot|Mail.RU_Bot|AhrefsBot|msnbot|YandexBot|DotBot|YandexMobileBot|YandexMetrika|YandexCatalog|YandexMarket|YandexAccessibilityBot|YandexImages|YandexPagechecker|YandexImageResizer|pingadmin|HostTracker|ia_archiver|AdsBot-Google|BingPreview|FeedFetcher|Baiduspider|SemrushBot)/i);
        if (Array.isArray(bots)) {
          return false;
        } else {
          return true;
        }
    }

    var server_path = ('https:' == document.location.protocol ? 'https://' : 'http://') + 'counter.insales.ru';

    var referrer = (window.decodeURI)?window.decodeURI(document.referrer):document.referrer;
    var resource = (window.decodeURI)?window.decodeURI(document.URL):document.URL;

    var uniq  = 0;
    var visit = 0;

    if (readCookie('visit')) {
        visit = 1
    }
    var today = new Date();
    var expire_time = today.getTime() + 30 * 60 * 1000; // 30 min
    setCookie('visit', 't', expire_time);

    // чтобы зря не слать запросы к серверу, шлём данные только о новых посетителях
    var isNewVisitor = visit == 0;

    if (isHuman() && isNewVisitor) {
        var loc = server_path +
        '?visit=' + visit +
        '&id=' + __id +
        '&cl='+encodeURIComponent(resource)+
        '&r=' +encodeURIComponent(referrer);

        getUrl(loc);
    }

})();
