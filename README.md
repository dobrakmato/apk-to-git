apk-to-git
-----------------

Cron script to automatically decompile APK from Google Play to Git repository.

### Configuration

Copy `config.example.js` to `config.js` and make modifications as needed.

```javascript
module.exports = {
    "packageName": "com.app",
    "targetFolder": "./git_repo_work_dir",
    "versionFile": "./local_version",
    "git": {
        "repository": "http://repository.com/username/android-app.git",
        "credentials": {
            "username": "username",
            "password": "password",
        },
        "author": {
            "name": "Bot",
            "email": "bot@apktogit"
        },
        "commiter": {
            "name": "Bot",
            "email": "bot@apktogit"
        }
    }
};
```


### Running

Setup a cron job to trigger the script. The script will periodically download apk file from
application store, decompile it and check if there is a new version.

If it finds new version it will automatically commit and force-push these changes to a specified
git repository. 