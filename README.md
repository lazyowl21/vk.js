# vk.js
Simple implementation of VK API in Node.js. 

## Usage

### API Requests

    var vk = require("vk.js");
    var req = vk.Request( method, method_options );
    
Parameters:
 + method [string] 
 + method_options \[object\]\(optional\)

Returns:
Promise option. 
  

[Authorization Code Flow](https://new.vk.com/dev/authcode_flow_user) and [Client Credentials Flow](https://new.vk.com/dev/client_cred_flow)  
