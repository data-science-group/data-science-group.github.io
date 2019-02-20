<?php

require("src/PHPMailer.php");
require("src/SMTP.php");
require("src/Exception.php");
error_reporting(0);
function get_val($val)
{
    if(!empty($val))
    return $val;

    return '';

}
$mail = new PHPMailer\PHPMailer\PHPMailer();
                            // Passing `true` enables exceptions
try {

    foreach ($_POST['datas'] as $v)
        $array_of_param[$v['name']]=$v['value'];
   //// for example radio1 value:

    $q1=get_val($array_of_param['q1']);
    $q2=get_val($array_of_param['q2']);
    $q3=get_val($array_of_param['q3']);
    $q4=get_val($array_of_param['q4']);
    $q5=get_val($array_of_param['q5']);
    $t1=get_val($array_of_param['t1']);
    $t2=get_val($array_of_param['t2']);
    $t3=get_val($array_of_param['t3']);

    $text="";
    $text.="<strong>Question 1 : </strong><br>".$q1."<br><br>";
    $text.="<strong>Question 2 : </strong><br>".$q2."<br><br>";
    $text.="<strong>Question 3 : </strong><br>".$q3."<br><br>";
    $text.="<strong>Question 4 : </strong><br>".$q4."<br><br>";
    $text.="<strong>Question 5 : </strong><br>".$q5."<br><br>";
    $text.="<strong>Question 6 : </strong><br>".$t1."<br><br>";
    $text.="<strong>Question 7 : </strong><br>".$t2."<br><br>";
    $text.="<strong>Question 8 : </strong><br>".$t3."<br><br>";

    //Server settings
    $mail->IsSMTP(); // enable SMTP
    //$mail->SMTPDebug = 1; // debugging: 1 = errors and messages, 2 = messages only
    $mail->SMTPAuth = true; // authentication enabled
    $mail->SMTPSecure = 'ssl'; // secure transfer enabled REQUIRED for Gmail
    $mail->Host =  "smtp.gmail.com";
    $mail->Port = 465; //465 or 587
    $mail->IsHTML(true);
    $mail->Username = "bigdatas44@gmail.com";
    $mail->Password = "TjFQ9DtEuUBY7rCX";
    $mail->SetFrom("bigdatas44@gmail.com");
    $mail->Subject = "Research Paper Survey Questions";
    $mail->Body =$text;
    $mail->AddAddress("amin.beheshti@gmail.com");

    if(!$mail->Send()) {
        echo "Mailer Error: " . $mail->ErrorInfo;
    } else {
        echo "Message has been sent";
    }
} catch (Exception $e) {
    echo 'Message could not be sent. Mailer Error: ', $mail->ErrorInfo;
}


?>
