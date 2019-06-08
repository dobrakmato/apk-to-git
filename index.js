const config = require('./config.js');
const puppeteer = require("puppeteer");
const rimraf = require("rimraf");
const path = require("path");
const process = require("process");
const fs = require("fs");
const child_process = require('child_process');
const git = require("nodegit");
const libxmljs = require("libxmljs");

async function download(downloadDir) {
    console.log("Starting puppeteer...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: {
            width: 1920,
            height: 1080
        }
    });
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow', downloadPath: downloadDir,
    });

    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3312.0 Safari/537.36");
    const url = 'https://apkcombo.com/en-sk/apk-downloader/?q=' + config.packageName;
    console.log("Navigating to " + url);
    await page.goto(url, {waitUntil: 'networkidle0'});

    await page.waitForSelector('.abutton.is-success');
    await page.click('.abutton.is-success'); // this redirects us to download page
    await page.waitForSelector('.abutton.is-success');

    console.log("Downloading APK...");

    await page.click('.abutton.is-success'); // this redirects us to download page
    await page.waitFor(10000);
    await browser.close();
}

let cleanUp = function (downloadDir) {
    console.log("Clearing download directory...");
    rimraf.sync(downloadDir);
};

let renameFile = function (downloadDir) {
    const downloads = fs.readdirSync(downloadDir);
    if (downloads.length !== 1) {
        console.error("Downloaded more then one or less files!");
        process.exit(1);
    }

    console.log("Renaming downloaded file");
    fs.renameSync(path.join(downloadDir, downloads[0]), path.join(downloadDir, 'app.apk'));
};

async function jadx(apkPath, targetDir) {
    console.log("Decompiling...");
    const isWindows = /^win/.test(process.platform);
    const jadxApp = path.resolve(__dirname, 'jadx', 'bin', 'jadx' + (isWindows ? ".bat" : ""));
    const jadxArgs = ['--no-debug-info', '-dr', targetDir, '-ds', path.join(targetDir, 'java'), apkPath];

    const decompileLog = fs.createWriteStream(path.resolve(__dirname, 'jadx.log'));

    await new Promise(resolve => {
        const proc = child_process.spawn(jadxApp, jadxArgs);
        proc.stderr.pipe(decompileLog);
        proc.stdout.pipe(decompileLog);
        proc.on('close', _ => {
            resolve();
        })
    });
    console.log("Decompiled!")
}

async function gitPush(targetFolder, version) {
    const repo = await git.Repository.open(targetFolder);
    const index = await repo.refreshIndex();
    const status = await repo.getStatus();

    if (status.length === 0) {
        return console.log("No changes detected.");
    }
    console.log("Found " + status.length + " changes in repository!");

    console.log("Adding files...");
    for (let e of status) {
        await index.addByPath(e.path());
    }

    index.write();
    const tree = await index.writeTree();

    const message = "Updated to version " + version;

    console.log("Committing...");
    const head = await repo.getHeadCommit();

    console.log("Head is: " + head);

    await repo.createCommit("HEAD",
        git.Signature.now(config.git.author.name, config.git.author.email),
        git.Signature.now(config.git.commiter.name, config.git.commiter.email),
        message, tree, head == null ? [] : [head]
    );

    console.log("Pushing to remote 'origin'.");
    const remote = await repo.getRemote("origin");
    try {
        await remote.push(["+refs/heads/master:refs/heads/master"], {
            callbacks: {
                credentials: function (url, userName) {
                    return git.Cred.userpassPlaintextNew(config.git.credentials.username, config.git.credentials.password)
                },
                transferProgress: function (progress) {
                    console.log(progress);
                }
            },
        });
    } catch (e) {
        console.error("Push failed!");
        console.error(e);
        throw e;
    }
}

async function extractVersion(targetFolder) {
    const contents = fs.readFileSync(path.resolve(__dirname, targetFolder, 'AndroidManifest.xml'));
    const doc = libxmljs.parseXml(contents.toString('utf-8'));
    const manifest = doc.get('//manifest');

    const versionCode = manifest.attr('versionCode').value();
    const versionName = manifest.attr('versionName').value();

    return [versionCode, versionCode + ' (' + versionName + ')'];
}

async function gitReset(targetFolder) {
    try {
        const repo = await git.Repository.open(targetFolder);
        console.log("Resetting local changes in GIT repository.");
        const head = await repo.getHeadCommit();
        console.log("Head commit: " + ((head === null) ? "null" : (head.id() + " " + head.message())));
        await git.Reset.default(repo, head, '.');
    } catch (e) {
        console.log("Cannot open repository at specified path.");
        console.log(e);
        console.log("Creating new repository...");
        fs.mkdirSync(targetFolder);
        const repo = await git.Repository.init(targetFolder, 0);
        git.Remote.create(repo, "origin", config.git.repository);
    }
}

let loadLocalVersion = function () {
    try {
        return fs.readFileSync(path.join(__dirname, config.versionFile));
    } catch (e) {
        return 0;
    }
};

function saveLocalVersion(versionCode) {
    fs.writeFileSync(path.join(__dirname, config.versionFile), versionCode);
}

(async () => {
    const downloadDir = path.resolve(__dirname, 'downloaded');

    await gitReset(config.targetFolder);
    await cleanUp(downloadDir);
    await download(downloadDir);
    await renameFile(downloadDir);
    await jadx(path.join(downloadDir, 'app.apk'), config.targetFolder);

    const [versionCode, version] = await extractVersion(config.targetFolder);
    const localVersionCode = await loadLocalVersion();

    console.log("Last committed version (local): " + localVersionCode);
    console.log("Current version (decompiled): " + versionCode);

    if (versionCode > localVersionCode) {
        console.log("Newer version decompiled. Pushing to git.");
        try {
            await gitPush(config.targetFolder, version);
            await saveLocalVersion(versionCode);
        } catch (e) {
            console.log("Since git push failed. Not marking version as pushed.");
        }
    }

    console.log("All done!");
})();