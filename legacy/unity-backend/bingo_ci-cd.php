<?php

// Use bash command to shell_exec
// function run shell script to deploy data into root directory of project
$output = shell_exec('sudo /usr/bin/bash /opt/script/bingo_cd.sh');

// and directory
echo "<pre>$output</pre>";
?>

